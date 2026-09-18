import type { Env } from "./env";
import { searchKnowledge, searchKnowledgeLexical } from "./search";

export type AskChannel = "web" | "telegram" | "gpt" | "api";

export interface AskRequest {
  question: string;
  channel?: AskChannel;
  top_k?: number;
}

type EvidenceStatus = "supported" | "partial" | "no_evidence" | "conflict";

type RankedMatch = {
  score: number;
  rank_score: number;
  fusion_score?: number;
  need_ids?: string[];
  retrieval_kinds?: string[];
  chunk_id: string;
  source_id: string;
  version_id?: string;
  title: string;
  grade: string;
  reference_score?: number | null;
  chapter?: string | null;
  section?: string | null;
  text: string;
};

type ParsedModelAnswer = {
  answer: string;
  evidence_status: EvidenceStatus | null;
  conflict: boolean;
  conflict_summary: string | null;
};

type InformationNeed = {
  id: string;
  label: string;
  query: string;
  required: boolean;
  aliases: string[];
};

type RetrievalPlan = {
  need_id: string;
  query: string;
  kind: "global" | "need" | "conflict";
};

type RetrievalRun = {
  plan: RetrievalPlan;
  kind: "semantic" | "lexical";
  matches: any[];
};

type CoverageItem = {
  id: string;
  label: string;
  covered: boolean;
  evidence_count: number;
  best_score: number;
};

const gradeAuthority: Record<string, number> = {
  A: 1,
  B: 0.85,
  Supplemental: 0.65,
  Reject: 0
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function looksPersian(text: string) {
  return /[\u0600-\u06FF]/.test(text);
}

function noEvidenceAnswer(question: string) {
  return looksPersian(question)
    ? "در منابع تأییدشدهٔ فعلی پایگاه دانش، شواهد کافی برای پاسخ قابل اتکا پیدا نشد."
    : "The current approved knowledge base does not contain enough evidence for a reliable answer.";
}

function rankMatches(matches: any[], minScore: number): RankedMatch[] {
  const eligible = matches.filter((m) => Number(m.score ?? 0) >= minScore);
  const maxFusion = Math.max(
    0,
    ...eligible.map((m) => Number(m.fusion_score ?? 0))
  );

  return eligible
    .map((m) => {
      const retrievalScore = Number(m.score ?? 0);
      const gradeWeight = gradeAuthority[String(m.grade ?? "")] ?? 0.5;
      const referenceScore = Number(m.reference_score ?? 50) / 100;
      const authority = gradeWeight * 0.6 + referenceScore * 0.4;
      const fusion = maxFusion > 0
        ? Number(m.fusion_score ?? 0) / maxFusion
        : 0;

      return {
        ...m,
        score: retrievalScore,
        reference_score: Number(m.reference_score ?? 0),
        rank_score: retrievalScore * 0.62 + fusion * 0.26 + authority * 0.12
      } as RankedMatch;
    })
    .sort((a, b) => b.rank_score - a.rank_score);
}
function chunkOrdinal(chunkId: string) {
  const match = chunkId.match(/C(\d+)$/);
  return match ? Number(match[1]) : null;
}

function normalizeEvidenceText(text: string) {
  return text
    .toLowerCase()
    .replace(/\[s\d+\]/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceTokens(text: string) {
  return new Set(
    normalizeEvidenceText(text)
      .split(" ")
      .filter((token) => token.length >= 3)
  );
}

function tokenOverlap(a: string, b: string) {
  const left = evidenceTokens(a);
  const right = evidenceTokens(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared++;
  }

  return shared / Math.min(left.size, right.size);
}

function bestEvidenceLabel(answer: string, chosen: RankedMatch[]) {
  if (!answer.trim() || !chosen.length) return null;

  const scored = chosen
    .map((match, index) => ({
      label: `S${index + 1}`,
      overlap: tokenOverlap(answer, match.text),
      retrieval: match.score
    }))
    .sort((a, b) =>
      (b.overlap * 0.85 + b.retrieval * 0.15) -
      (a.overlap * 0.85 + a.retrieval * 0.15)
    );

  const best = scored[0];
  if (!best || best.overlap < 0.12) return null;
  return best.label;
}

function isNearDuplicateEvidence(candidate: RankedMatch, chosen: RankedMatch[]) {
  const candidateOrdinal = chunkOrdinal(candidate.chunk_id);

  return chosen.some((existing) => {
    const overlap = tokenOverlap(candidate.text, existing.text);
    if (overlap >= 0.82) return true;
    if (candidate.source_id !== existing.source_id) return false;

    const existingOrdinal = chunkOrdinal(existing.chunk_id);
    const adjacent =
      candidateOrdinal !== null &&
      existingOrdinal !== null &&
      Math.abs(candidateOrdinal - existingOrdinal) <= 1;

    return overlap >= 0.68 || (adjacent && overlap >= 0.52);
  });
}

function buildCoverageContext(
  matches: RankedMatch[],
  needs: InformationNeed[],
  maxChars = 20000
) {
  const chosen: RankedMatch[] = [];
  const requiredNeeds = needs.filter((need) => need.required);
  const operationalMaxChunks = Math.min(
    12,
    Math.max(6, requiredNeeds.length + 4)
  );
  let used = 0;

  const maxChunkChars = requiredNeeds.length >= 4 ? 2600 : 3400;

  const canChoose = (match: RankedMatch, coveragePass = false) => {
    if (chosen.length >= operationalMaxChunks) return false;
    if (match.score < 0.5) return false;

    const text = String(match.text ?? "").trim();
    if (!text) return false;
    if (isNearDuplicateEvidence(match, chosen)) return false;

    const fromSameSource = chosen.filter(
      (existing) => existing.source_id === match.source_id
    ).length;
    // Source diversity is useful when filling spare context, but it must never
    // prevent a requested information need from receiving evidence.
    if (!coveragePass && fromSameSource >= 3) return false;

    const remaining = maxChars - used;
    if (remaining < 500) return false;

    const clipped = text.slice(0, Math.min(remaining, maxChunkChars));
    chosen.push({ ...match, text: clipped });
    used += clipped.length;
    return true;
  };

  // First pass: reserve coverage, not a fixed chunk count, for every required
  // information need that has direct eligible evidence.
  for (const need of requiredNeeds) {
    const candidate = matches.find((match) =>
      match.need_ids?.includes(need.id) &&
      match.score >= 0.5 &&
      !chosen.some((existing) => existing.chunk_id === match.chunk_id) &&
      !isNearDuplicateEvidence(match, chosen)
    );
    if (candidate) canChoose(candidate, true);
  }

  // Second pass: fill the remaining context by marginal value. New need
  // coverage and source diversity beat redundant high-similarity chunks.
  while (chosen.length < operationalMaxChunks) {
    const coveredNeedIds = new Set(
      chosen.flatMap((match) => match.need_ids ?? [])
    );
    const seenSources = new Set(chosen.map((match) => match.source_id));

    const candidate = matches
      .filter((match) =>
        match.score >= 0.5 &&
        !chosen.some((existing) => existing.chunk_id === match.chunk_id) &&
        !isNearDuplicateEvidence(match, chosen)
      )
      .map((match) => {
        const newNeeds = (match.need_ids ?? []).filter(
          (needId) => needId !== "global" && !coveredNeedIds.has(needId)
        ).length;
        const sourceBonus = seenSources.has(match.source_id) ? 0 : 0.025;
        const marginal = match.rank_score + newNeeds * 0.09 + sourceBonus;
        return { match, marginal };
      })
      .sort((a, b) => b.marginal - a.marginal)[0]?.match;

    if (!candidate || !canChoose(candidate)) break;
  }

  const coverage: CoverageItem[] = requiredNeeds.map((need) => {
    const supporting = chosen.filter((match) =>
      match.need_ids?.includes(need.id)
    );
    return {
      id: need.id,
      label: need.label,
      covered: supporting.length > 0,
      evidence_count: supporting.length,
      best_score: Number(
        Math.max(0, ...supporting.map((match) => match.score)).toFixed(4)
      )
    };
  });

  const coveredCount = coverage.filter((item) => item.covered).length;
  const coverageRatio = coverage.length
    ? coveredCount / coverage.length
    : chosen.length
      ? 1
      : 0;

  const needById = new Map(needs.map((need) => [need.id, need.label]));
  const context = chosen.map((m, index) => {
    const label = `S${index + 1}`;
    const location = [m.chapter, m.section].filter(Boolean).join(" > ");
    const supports = (m.need_ids ?? [])
      .filter((needId) => needId !== "global")
      .map((needId) => needById.get(needId) ?? needId);

    return [
      `[${label}]`,
      `supports: ${supports.length ? supports.join(" | ") : "whole question"}`,
      `source_id: ${m.source_id}`,
      `title: ${m.title}`,
      `grade: ${m.grade}`,
      `reference_score: ${m.reference_score ?? ""}`,
      `version_id: ${m.version_id ?? ""}`,
      `location: ${location || "not specified"}`,
      `retrieval_score: ${m.score.toFixed(4)}`,
      "evidence:",
      m.text
    ].join("\n");
  }).join("\n\n---\n\n");

  const needSummary = requiredNeeds.length
    ? requiredNeeds.map((need, index) => {
        const item = coverage.find((entry) => entry.id === need.id);
        return `N${index + 1}. ${need.label} — evidence: ${item?.covered ? "available" : "missing"}`;
      }).join("\n")
    : "N1. Whole question — evidence: " + (chosen.length ? "available" : "missing");

  return {
    chosen,
    context,
    coverage,
    coverageRatio: Number(coverageRatio.toFixed(3)),
    needSummary
  };
}
function confidenceFor(matches: RankedMatch[], evidenceStatus: EvidenceStatus) {
  if (!matches.length || evidenceStatus === "no_evidence") {
    return {
      level: "low",
      score: 0,
      reason: "No eligible evidence passed the retrieval threshold."
    };
  }

  const top = matches[0].score;
  const gradeWeight = gradeAuthority[matches[0].grade] ?? 0.5;
  const referenceScore = Number(matches[0].reference_score ?? 50) / 100;
  const authority = gradeWeight * 0.6 + referenceScore * 0.4;
  const supportBonus = Math.min(matches.length, 4) * 0.025;
  const raw = clamp(top * 0.72 + authority * 0.23 + supportBonus, 0, 0.95);

  let level: "low" | "medium" | "high" = "low";
  if (raw >= 0.72) level = "high";
  else if (raw >= 0.52) level = "medium";

  return {
    level,
    score: Number(raw.toFixed(2)),
    reason: "Heuristic based on retrieval similarity, source authority grade, and number of supporting chunks; it is not a calibrated probability."
  };
}

function ensureInlineCitation(answer: string, sourceCount: number) {
  const trimmed = answer.trim();
  if (!trimmed || sourceCount < 1) return trimmed;
  if (/\[S\d+\]/.test(trimmed)) return trimmed;
  return trimmed + " [S1]";
}

function citedSourceLabels(answer: string) {
  const labels = new Set<string>();
  for (const match of answer.matchAll(/\[(S\d+)\]/g)) {
    labels.add(match[1]);
  }
  return labels;
}

function citedSourceIds(answer: string, chosen: RankedMatch[]) {
  const labels = citedSourceLabels(answer);
  return new Set(
    chosen
      .filter((_, index) => labels.has(`S${index + 1}`))
      .map((match) => match.source_id)
  );
}

function ensureConflictCitations(answer: string, chosen: RankedMatch[]) {
  const trimmed = answer.trim();
  const distinctChosen = new Set(chosen.map((match) => match.source_id));
  if (!trimmed || distinctChosen.size < 2) return trimmed;

  const alreadyCited = citedSourceIds(trimmed, chosen);
  if (alreadyCited.size >= 2) return trimmed;

  const topScore = chosen[0]?.score ?? 0;
  const alternateIndex = chosen.findIndex((match) =>
    !alreadyCited.has(match.source_id) &&
    match.score >= Math.max(0.5, topScore - 0.2)
  );

  if (alternateIndex < 0) return trimmed;
  const label = `S${alternateIndex + 1}`;

  // The model has already declared a material conflict from the supplied
  // evidence. If it cited only one side, attach the strongest independent
  // evidence label so source metadata and the conflict claim stay aligned.
  return `${trimmed} [${label}]`;
}

function modelText(raw: unknown) {
  const obj = raw as any;
  const choiceContent = obj?.choices?.[0]?.message?.content;

  if (typeof raw === "string") return raw;
  if (typeof choiceContent === "string") return choiceContent;
  if (Array.isArray(choiceContent)) {
    return choiceContent.map((part: any) => part?.text ?? "").join("");
  }
  if (typeof obj?.response === "string") return obj.response;
  if (obj?.response && typeof obj.response === "object") return JSON.stringify(obj.response);
  if (typeof obj?.result?.response === "string") return obj.result.response;
  if (obj?.result?.response && typeof obj.result.response === "object") {
    return JSON.stringify(obj.result.response);
  }
  if (obj?.answer) return JSON.stringify(obj);
  return "";
}

function extractJsonStringField(text: string, field: string) {
  const pattern = new RegExp(
    `"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
    "s"
  );
  const match = text.match(pattern);
  if (!match) return null;

  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function parseModelJson(raw: unknown): ParsedModelAnswer {
  const cleaned = modelText(raw)
    .trim()
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/^\`\`\`\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      answer: String(parsed.answer ?? "").trim(),
      evidence_status: ["supported", "partial", "no_evidence", "conflict"].includes(String(parsed.evidence_status))
        ? String(parsed.evidence_status) as EvidenceStatus
        : null,
      conflict: Boolean(parsed.conflict),
      conflict_summary: parsed.conflict_summary ? String(parsed.conflict_summary) : null
    };
  } catch {
    const salvagedAnswer = extractJsonStringField(cleaned, "answer");
    const statusMatch = cleaned.match(
      /"evidence_status"\s*:\s*"(supported|partial|no_evidence|conflict)"/i
    );
    const conflictMatch = cleaned.match(/"conflict"\s*:\s*(true|false)/i);
    const salvagedSummary = extractJsonStringField(cleaned, "conflict_summary");

    return {
      answer: String(salvagedAnswer ?? cleaned).trim(),
      evidence_status: statusMatch
        ? statusMatch[1].toLowerCase() as EvidenceStatus
        : null,
      conflict: conflictMatch?.[1].toLowerCase() === "true",
      conflict_summary: salvagedSummary ? String(salvagedSummary) : null
    };
  }
}

function dedupeRepeatedSentences(answer: string) {
  const parts = answer.match(/[^.!?؟\n]+(?:[.!?؟]+|$)|\n+/g) ?? [answer];
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const part of parts) {
    if (/^\s*\n+\s*$/.test(part)) {
      if (kept.length && !/\n$/.test(kept[kept.length - 1])) kept.push("\n");
      continue;
    }

    const normalized = normalizeEvidenceText(
      part.replace(/\[S\d+\]/gi, " ")
    );

    if (normalized.length >= 28) {
      if (seen.has(normalized)) continue;
      seen.add(normalized);
    }

    kept.push(part.trim());
  }

  return kept
    .join(" ")
    .replace(/\s+\n\s+/g, "\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanAnswerArtifacts(answer: string) {
  return answer
    .replace(/\s*evidence[_ ]status\s*[:=]\s*(?:supported|partial|no_evidence|conflict)\s*$/i, "")
    .replace(/\s*conflict\s*[:=]\s*(?:true|false)\s*$/i, "")
    .trim();
}

function requestsConflictReview(question: string) {
  return /\b(conflict|conflicting|disagree|disagreement|different perspectives|different views|opposing|both perspectives)\b/i.test(question) ||
    /(اختلاف|متعارض|تعارض|دیدگاه متفاوت|هر دو دیدگاه|مخالف)/.test(question);
}

const conceptRules = [
  {
    id: "quality",
    label: "QC / evaluation",
    pattern: /\b(qc|quality control|quality assurance|evaluation|evaluator|llm[- ]?as[- ]?judge|validation|verification|groundedness|faithfulness)\b/i,
    faPattern: /(کنترل کیفیت|تضمین کیفیت|ارزیابی|ارزیاب|اعتبارسنجی|سنجش کیفیت|کیفیت پاسخ)/,
    query: "LLM response evaluation quality control evaluator LLM-as-judge groundedness faithfulness correctness relevance completeness reliability",
    aliases: ["qc", "quality", "evaluation", "ارزیابی", "کیفیت"]
  },
  {
    id: "observability",
    label: "Logging / observability",
    pattern: /\b(log|logs|logging|trace|tracing|telemetry|observability|monitoring|audit)\b/i,
    faPattern: /(لاگ|لاگینگ|مانیتور|مانیتورینگ|ردیابی|تریس|مشاهده.?پذیری|ممیزی)/,
    query: "LLM agent observability logging tracing telemetry request response model latency token usage errors retries tool execution request id correlation id production monitoring",
    aliases: ["logging", "observability", "trace", "لاگ", "مانیتورینگ", "ردیابی"]
  },
  {
    id: "cost",
    label: "Cost / FinOps",
    pattern: /\b(cost|finops|token usage|usage cost|budget)\b/i,
    faPattern: /(هزینه|مصرف توکن|بودجه|فین.?آپ)/,
    query: "LLM cost token usage inference cost budget FinOps optimization monitoring",
    aliases: ["cost", "finops", "هزینه", "توکن"]
  },
  {
    id: "security",
    label: "Security / guardrails",
    pattern: /\b(security|guardrail|prompt injection|jailbreak|authorization|authentication|safety)\b/i,
    faPattern: /(امنیت|گاردریل|تزریق پرامپت|پرامپت اینجکشن|احراز هویت|مجوز|ایمنی)/,
    query: "AI agent security guardrails prompt injection tool authorization safety access control",
    aliases: ["security", "guardrail", "امنیت", "گاردریل"]
  },
  {
    id: "retry",
    label: "Retry / recovery",
    pattern: /\b(retry|retries|recovery|failover|failure handling|backoff)\b/i,
    faPattern: /(تلاش مجدد|بازیابی|خطا|شکست|فیل.?اور|ریترا)/,
    query: "AI agent retry recovery failure handling backoff failover resilience errors",
    aliases: ["retry", "recovery", "خطا", "بازیابی"]
  },
  {
    id: "memory",
    label: "Memory",
    pattern: /\b(memory|long-term memory|short-term memory)\b/i,
    faPattern: /(حافظه|مموری)/,
    query: "AI agent memory short-term long-term episodic semantic conversation memory",
    aliases: ["memory", "حافظه", "مموری"]
  },
  {
    id: "planning",
    label: "Planning",
    pattern: /\b(planning|planner|plan)\b/i,
    faPattern: /(برنامه.?ریزی|پلنینگ)/,
    query: "AI agent planning planner task decomposition execution plan",
    aliases: ["planning", "برنامه ریزی", "برنامه‌ریزی"]
  },
  {
    id: "reflection",
    label: "Reflection",
    pattern: /\b(reflection|self-reflection|reflect)\b/i,
    faPattern: /(رفلکشن|بازبینی|خود.?بازبینی)/,
    query: "AI agent reflection self-reflection critique revise feedback",
    aliases: ["reflection", "بازبینی", "رفلکشن"]
  },
  {
    id: "rag",
    label: "RAG / grounding",
    pattern: /\b(rag|retrieval augmented generation|grounding|citation)\b/i,
    faPattern: /(رگ|بازیابی افزوده|گراند|استناد|سایتیشن)/,
    query: "RAG retrieval augmented generation grounding citation evidence knowledge",
    aliases: ["rag", "grounding", "رگ", "استناد"]
  },
  {
    id: "retrieval",
    label: "Retrieval",
    pattern: /\b(retrieval|rerank|reranker|vector search|semantic search|hybrid search)\b/i,
    faPattern: /(بازیابی|ریتریوال|ری.?رنک|جست.?وجوی برداری|جست.?وجوی معنایی)/,
    query: "retrieval reranking vector search semantic search hybrid search evidence selection",
    aliases: ["retrieval", "rerank", "بازیابی"]
  },
  {
    id: "tools",
    label: "Tool use",
    pattern: /\b(tool|tools|tool call|function calling)\b/i,
    faPattern: /(ابزار|تول کال|فانکشن کال)/,
    query: "AI agent tools tool calling function calling tool execution errors",
    aliases: ["tool", "tools", "ابزار"]
  },
  {
    id: "multi-agent",
    label: "Multi-agent",
    pattern: /\b(multi-agent|multi agent|agent-to-agent|a2a)\b/i,
    faPattern: /(مولتی.?ایجنت|چند.?عاملی|چند ایجنت|عامل.?به.?عامل)/,
    query: "multi-agent systems agent-to-agent A2A orchestration coordination handoff",
    aliases: ["multi-agent", "a2a", "چند عاملی"]
  },
  {
    id: "mcp",
    label: "MCP",
    pattern: /\b(mcp|model context protocol)\b/i,
    faPattern: /(ام.?سی.?پی|پروتکل کانتکست مدل)/,
    query: "Model Context Protocol MCP tools resources prompts agent integration",
    aliases: ["mcp", "ام سی پی"]
  },
  {
    id: "context",
    label: "Context engineering",
    pattern: /\b(context engineering|context window|context management|context)\b/i,
    faPattern: /(کانتکست|زمینه|مهندسی زمینه|مدیریت زمینه)/,
    query: "AI context engineering context management context window prompt context selection",
    aliases: ["context", "کانتکست", "زمینه"]
  }
] as const;

function splitExplicitQuestionParts(question: string) {
  const numbered = question.replace(
    /(?:^|\s)(?:\d+|[۱-۹])[.)-]\s*/g,
    "\n"
  );
  let parts = numbered
    .split(/[؛;\n]+|،|,(?=\s)/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);

  if (parts.length <= 1) {
    const conjunctive = question
      .split(/\s+(?:و|and|&)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3);

    if (
      conjunctive.length >= 3 &&
      conjunctive.length <= 8 &&
      conjunctive.every((part) => part.length <= 140)
    ) {
      parts = conjunctive;
    }
  }

  return Array.from(new Set(parts)).slice(0, 8);
}

function isQuestionFramingPart(part: string) {
  const normalized = normalizeEvidenceText(part);
  if (!normalized) return true;

  const looksLikeContextPrefix =
    /^(for|برای)\b/i.test(part.trim()) &&
    /(ai agent|agent|ایجنت|عامل)/i.test(part) &&
    /(production|پروداکشن|تولید|system|سیستم)/i.test(part);

  const framingOnly =
    /^(for|برای|درباره|about)\b/i.test(part.trim()) &&
    normalized.split(" ").length <= 8 &&
    !conceptRules.some((rule) =>
      rule.pattern.test(part) || rule.faPattern.test(part)
    );

  return looksLikeContextPrefix || framingOnly;
}

function isRelationalQuestion(question: string) {
  return requestsConflictReview(question) ||
    /\b(compare|comparison|difference|different from|versus|vs\.?|complement|relationship|relate|trade-?off|interact|interaction)\b/i.test(question) ||
    /(مقایسه|تفاوت|فرق|چه فرقی|رابطه|ارتباط بین|در برابر|مکمل|تعامل|ترید.?آف)/.test(question);
}

function buildInformationNeeds(question: string): InformationNeed[] {
  // Relationship/comparison questions are one information need even when they
  // mention several concepts. Splitting them would destroy the relationship
  // the user is actually asking about.
  if (isRelationalQuestion(question)) {
    return [{
      id: "primary",
      label: question.slice(0, 100),
      query: question,
      required: true,
      aliases: []
    }];
  }

  const needs: InformationNeed[] = [];
  const matchedRules = conceptRules.filter((rule) =>
    rule.pattern.test(question) || rule.faPattern.test(question)
  );

  for (const rule of matchedRules) {
    needs.push({
      id: rule.id,
      label: rule.label,
      query: rule.query,
      required: true,
      aliases: [...rule.aliases]
    });
  }

  const explicitParts = splitExplicitQuestionParts(question);
  if (explicitParts.length >= 2) {
    explicitParts.forEach((part, index) => {
      const coveredByRule = matchedRules.some((rule) =>
        rule.pattern.test(part) || rule.faPattern.test(part)
      );
      if (!coveredByRule && !isQuestionFramingPart(part)) {
        needs.push({
          id: `part-${index + 1}`,
          label: part.slice(0, 90),
          query: part,
          required: true,
          aliases: []
        });
      }
    });
  }

  if (!needs.length) {
    return [{
      id: "primary",
      label: question.slice(0, 100),
      query: question,
      required: true,
      aliases: []
    }];
  }

  const deduped = new Map<string, InformationNeed>();
  for (const need of needs) deduped.set(need.id, need);
  return Array.from(deduped.values()).slice(0, 8);
}

function buildRetrievalPlans(
  question: string,
  needs: InformationNeed[],
  conflictQueries: string[]
): RetrievalPlan[] {
  const globalNeedId =
    needs.length === 1 && needs[0].id === "primary"
      ? "primary"
      : "global";

  const plans: RetrievalPlan[] = [{
    need_id: globalNeedId,
    query: question,
    kind: "global"
  }];

  for (const need of needs) {
    if (need.query.trim() && need.query.trim() !== question.trim()) {
      plans.push({
        need_id: need.id,
        query: need.query,
        kind: "need"
      });
    }
  }

  for (const query of conflictQueries) {
    plans.push({
      need_id: globalNeedId,
      query,
      kind: "conflict"
    });
  }

  const unique = new Map<string, RetrievalPlan>();
  for (const plan of plans) {
    unique.set(`${plan.need_id}::${plan.query}`, plan);
  }
  return Array.from(unique.values());
}

async function runRetrievalPlan(
  env: Env,
  plan: RetrievalPlan,
  topK: number
): Promise<RetrievalRun[]> {
  const [semantic, lexical] = await Promise.all([
    searchKnowledge(env, plan.query, topK),
    searchKnowledgeLexical(env, plan.query, topK)
  ]);

  return [
    { plan, kind: "semantic", matches: semantic },
    { plan, kind: "lexical", matches: lexical }
  ];
}

function fuseRetrievalResults(runs: RetrievalRun[]) {
  const fused = new Map<string, {
    match: any;
    fusion_score: number;
    need_ids: Set<string>;
    retrieval_kinds: Set<string>;
  }>();
  const rrfK = 60;

  for (const run of runs) {
    const channelWeight = run.kind === "semantic" ? 1 : 0.9;
    const planWeight = run.plan.kind === "need"
      ? 1.15
      : run.plan.kind === "conflict"
        ? 1.1
        : 1;

    run.matches.forEach((match, index) => {
      const key = String(match.chunk_id ?? "");
      if (!key) return;

      const contribution =
        channelWeight * planWeight / (rrfK + index + 1);
      const existing = fused.get(key);

      if (!existing) {
        fused.set(key, {
          match,
          fusion_score: contribution,
          need_ids: new Set([run.plan.need_id]),
          retrieval_kinds: new Set([run.kind])
        });
        return;
      }

      existing.fusion_score += contribution;
      existing.need_ids.add(run.plan.need_id);
      existing.retrieval_kinds.add(run.kind);

      if (Number(match.score ?? 0) > Number(existing.match.score ?? 0)) {
        existing.match = match;
      }
    });
  }

  return Array.from(fused.values())
    .map((entry) => ({
      ...entry.match,
      fusion_score: entry.fusion_score,
      need_ids: Array.from(entry.need_ids),
      retrieval_kinds: Array.from(entry.retrieval_kinds)
    }))
    .sort((a, b) =>
      Number(b.fusion_score ?? 0) - Number(a.fusion_score ?? 0)
    );
}
async function expandConflictQueries(env: Env, question: string) {
  if (!requestsConflictReview(question)) return [] as string[];

  const model = env.GENERATION_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";

  try {
    const generated = await env.AI.run(
      model as any,
      {
        messages: [
          {
            role: "system",
            content: `You generate retrieval queries only. Do not answer the question.\nGiven a question that asks whether approved sources disagree, produce two short semantic-search queries:\n1) one query seeking evidence for the first/affirmative position,\n2) one query seeking evidence for the contrasting/opposing position.\nPreserve the user's technical concepts and named terms. Do not add unrelated facts.\nReturn JSON only: {"support_query":"string","challenge_query":"string"}`
          },
          { role: "user", content: question }
        ],
        max_tokens: 160,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            type: "object",
            properties: {
              support_query: { type: "string" },
              challenge_query: { type: "string" }
            },
            required: ["support_query", "challenge_query"]
          }
        }
      } as any
    ) as any;

    const cleaned = modelText(generated)
      .trim()
      .replace(/^\`\`\`json\s*/i, "")
      .replace(/^\`\`\`\s*/i, "")
      .replace(/\`\`\`$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    const variants = [parsed.support_query, parsed.challenge_query]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length >= 8 && value !== question);

    return Array.from(new Set(variants)).slice(0, 2);
  } catch {
    return [] as string[];
  }
}

export async function answerQuestion(env: Env, input: AskRequest) {
  const question = String(input.question ?? "").trim();
  const channel: AskChannel = input.channel ?? "api";
  const requestId = crypto.randomUUID();

  const requestedTopK = clamp(Number(input.top_k ?? 8), 3, 12);
  const minScore = clamp(Number(env.MIN_RETRIEVAL_SCORE ?? "0.40"), 0, 1);

  const conflictQueries = await expandConflictQueries(env, question);
  const needs = buildInformationNeeds(question);
  const retrievalPlans = buildRetrievalPlans(question, needs, conflictQueries);
  const retrievalRuns = (
    await Promise.all(
      retrievalPlans.map((plan) => runRetrievalPlan(env, plan, requestedTopK))
    )
  ).flat();
  const rawMatches = fuseRetrievalResults(retrievalRuns);
  const ranked = rankMatches(rawMatches, minScore);

  if (!ranked.length) {
    return {
      request_id: requestId,
      channel,
      answer: noEvidenceAnswer(question),
      evidence_status: "no_evidence" as EvidenceStatus,
      confidence: confidenceFor([], "no_evidence"),
      sources: [],
      retrieval: {
        retrieved: rawMatches.length,
        eligible: 0,
        min_score: minScore,
        query_count: retrievalPlans.length,
        search_runs: retrievalRuns.length,
        need_count: needs.length,
        coverage_ratio: 0,
        coverage: needs.map((need) => ({
          id: need.id,
          label: need.label,
          covered: false,
          evidence_count: 0,
          best_score: 0
        }))
      }
    };
  }

  const {
    chosen,
    context,
    coverage,
    coverageRatio,
    needSummary
  } = buildCoverageContext(ranked, needs);

  if (!chosen.length) {
    return {
      request_id: requestId,
      channel,
      answer: noEvidenceAnswer(question),
      evidence_status: "no_evidence" as EvidenceStatus,
      confidence: confidenceFor([], "no_evidence"),
      sources: [],
      retrieval: {
        retrieved: rawMatches.length,
        eligible: ranked.length,
        used: 0,
        min_score: minScore,
        query_count: retrievalPlans.length,
        search_runs: retrievalRuns.length,
        need_count: needs.length,
        coverage_ratio: 0,
        coverage
      }
    };
  }

  const initialEvidenceStatus: EvidenceStatus =
    coverage.length > 1 && coverageRatio < 1
      ? "partial"
      : chosen[0].score >= 0.52
        ? "supported"
        : "partial";

  const largeMultipart =
    needs.length >= 4 && !requestsConflictReview(question);
  const answerLanguage = looksPersian(question) ? "Persian (Farsi)" : "English";
  const outputContract = largeMultipart
    ? "Return only the final answer text with inline [S#] citations. Do not return JSON or metadata."
    : `Return JSON only with exactly:
{"answer":"string","evidence_status":"supported|partial|no_evidence|conflict","conflict":false,"conflict_summary":null}`;

  const system = `You are the AI Engineering Knowledge Agent.
Answer only from the supplied approved evidence. Do not use outside knowledge.
Distinguish what the evidence supports from inference. If evidence is incomplete, say so.
If supplied sources materially disagree, set conflict=true and explain the disagreement.
Use inline citations like [S1], [S2] for factual claims. Every factual paragraph or numbered/bulleted item should end with the source label(s) that directly support it.
If evidence_status is conflict, the answer MUST explicitly cite at least two distinct source labels representing the different positions. Never report a conflict using only one cited source.
Answer the user's actual question directly; do not restate the question as the opening sentence.
Select only evidence that directly helps answer the requested task. Ignore retrieved details that are merely about the same broad topic.
Before drafting, identify every explicit part of the user's request. If the question asks for multiple things, cover every supported part separately; never answer only the first part.
The user's required information needs are listed before the evidence. Treat each listed need as a distinct requested part.
Cover every need marked "evidence: available". If a need is marked "evidence: missing", state that the approved knowledge base does not provide enough direct evidence for that part and do not guess.
Do not let a highly relevant source for one need crowd out or substitute for another requested need.
For every covered information need, include at least one concrete mechanism, field, metric, validation criterion, or operational practice that is explicitly supported by its evidence. Do not fill a section with generic phrases such as "use monitoring" or "use quality control" when the evidence provides more specific detail.
For multi-part questions, use one compact section or bullet group per requested need and avoid repeating the same generic recommendation across sections.
For an explicit conflict review, compare the definitions' inclusion and exclusion criteria. If one approved source counts a class of system as the concept while another source explicitly excludes that class under its definition, treat that as a material definitional conflict even if the sources share some properties. Do not smooth an explicit inclusion/exclusion disagreement into merely complementary emphasis.
For "how", process, or implementation questions, prefer a short structured answer with 3-6 steps or bullets per major requested part when the evidence supports it.
Match answer depth to the question.
For broad, explanatory, comparative, or multi-part questions, normally use about 250-500 words when the evidence supports that depth.
For a simple single-fact question, stay brief.
Do not omit major supported subtopics merely to keep the answer short.
Never repeat the same claim, sentence, example, or sequence of steps. When evidence chunks overlap, synthesize the overlap once.
Do not mention implementation details such as memory classes, async/await, parsers, or tool plumbing unless they directly answer the user's question.
Do not expose long verbatim passages; synthesize.
Respond in the language of the user's question.
Judge whether the supplied evidence actually answers the user's question.
If the evidence is only topically related but does not support the requested fact, use evidence_status="no_evidence".
For a single specific fact request (for example an exact score, benchmark result, percentage, date, count, version, or named experiment), if that exact fact is absent from the evidence, use evidence_status="no_evidence", not "partial".
Use evidence_status="partial" only when the user's question has multiple meaningful parts and the evidence directly supports at least one part but not all parts.
If sources materially disagree, use evidence_status="conflict".
Always answer in the requested answer language.
${outputContract}`;

  const user = `Question:\n${question}\n\nAnswer language: ${answerLanguage}\n\nRequired information needs:\n${needSummary}\n\nApproved evidence:\n${context}`;
  const model = env.GENERATION_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";

  const generationRequest: any = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: largeMultipart ? 1400 : 1000,
    temperature: 0.1
  };

  if (!largeMultipart) {
    generationRequest.response_format = {
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: {
          answer: { type: "string", maxLength: 6000 },
          evidence_status: {
            type: "string",
            enum: ["supported", "partial", "no_evidence", "conflict"]
          },
          conflict: { type: "boolean" },
          conflict_summary: { type: "string" }
        },
        required: ["answer", "evidence_status", "conflict", "conflict_summary"]
      }
    };
  }

  const generated = await env.AI.run(
    model as any,
    generationRequest
  ) as any;

  let parsed: ParsedModelAnswer = largeMultipart
    ? {
        answer: modelText(generated)
          .trim()
          .replace(/^\`\`\`(?:text|markdown)?\s*/i, "")
          .replace(/\`\`\`$/i, "")
          .trim(),
        evidence_status: initialEvidenceStatus,
        conflict: false,
        conflict_summary: null
      }
    : parseModelJson(generated);

  if (
    chosen.length > 0 &&
    parsed.answer &&
    !/\[S\d+\]/.test(parsed.answer)
  ) {
    try {
      const repaired = await env.AI.run(
        model as any,
        {
          messages: [
            {
              role: "system",
              content: "You are a citation repairer. Return only the corrected answer text, not JSON. Preserve the draft's meaning, remove unsupported claims, and add the correct [S#] citation to every factual paragraph or list item. Use only the approved evidence and never invent a source label."
            },
            {
              role: "user",
              content: `Question:\n${question}\n\nApproved evidence:\n${context}\n\nDraft to repair:\n${parsed.answer}`
            }
          ],
          max_tokens: 900,
          temperature: 0
        } as any
      ) as any;

      const repairedText = modelText(repaired)
        .trim()
        .replace(/^\`\`\`(?:text|markdown)?\s*/i, "")
        .replace(/\`\`\`$/i, "")
        .trim();

      const preservesSubstance =
        repairedText.length >= Math.max(80, parsed.answer.length * 0.65);

      if (
        repairedText &&
        /\[S\d+\]/.test(repairedText) &&
        preservesSubstance
      ) {
        parsed = {
          ...parsed,
          answer: repairedText
        };
      }
    } catch {
      // Keep the original draft; deterministic fallback below is limited to one-source evidence.
    }
  }

  const distinctChosenSources = new Set(chosen.map((match) => match.source_id)).size;

  let modelEvidenceStatus: EvidenceStatus =
    parsed.conflict
      ? "conflict"
      : parsed.evidence_status ?? initialEvidenceStatus;

  // A cross-source conflict requires evidence from at least two distinct
  // approved sources. Do not allow a one-source answer to self-label conflict.
  if (modelEvidenceStatus === "conflict" && distinctChosenSources < 2) {
    modelEvidenceStatus = initialEvidenceStatus;
  }

  const evidenceStatus: EvidenceStatus =
    modelEvidenceStatus === "conflict"
      ? "conflict"
      : modelEvidenceStatus === "no_evidence"
        ? "no_evidence"
        : modelEvidenceStatus === "partial" || initialEvidenceStatus === "partial"
          ? "partial"
          : "supported";

  if (evidenceStatus === "no_evidence") {
    return {
      request_id: requestId,
      channel,
      answer: noEvidenceAnswer(question),
      evidence_status: "no_evidence" as EvidenceStatus,
      conflict_summary: null,
      confidence: confidenceFor([], "no_evidence"),
      sources: [],
      retrieval: {
        retrieved: rawMatches.length,
        eligible: ranked.length,
        used: chosen.length,
        min_score: minScore,
        query_count: retrievalPlans.length,
        search_runs: retrievalRuns.length,
        need_count: needs.length,
        coverage_ratio: coverageRatio,
        coverage,
        generation_model: model
      }
    };
  }

  const sources = chosen.map((m, index) => ({
    id: `S${index + 1}`,
    source_id: m.source_id,
    version_id: m.version_id ?? null,
    title: m.title,
    grade: m.grade,
    reference_score: m.reference_score ?? null,
    chapter: m.chapter ?? null,
    section: m.section ?? null,
    chunk_id: m.chunk_id,
    retrieval_score: Number(m.score.toFixed(4)),
    supports: (m.need_ids ?? []).filter((needId) => needId !== "global")
  }));

  const cleanedAnswer = cleanAnswerArtifacts(
    dedupeRepeatedSentences(
      parsed.answer || noEvidenceAnswer(question)
    )
  );

  let groundedAnswer = cleanedAnswer;

  if (
    groundedAnswer &&
    !/\[S\d+\]/.test(groundedAnswer) &&
    chosen.length > 0
  ) {
    if (distinctChosenSources === 1) {
      groundedAnswer = groundedAnswer + " [S1]";
    } else {
      const fallbackLabel = bestEvidenceLabel(groundedAnswer, chosen);
      if (fallbackLabel) {
        groundedAnswer = groundedAnswer + ` [${fallbackLabel}]`;
      }
    }
  }

  if (evidenceStatus === "conflict") {
    groundedAnswer = ensureConflictCitations(groundedAnswer, chosen);
  }

  const citedLabels = citedSourceLabels(groundedAnswer);
  const citedMatches = chosen.filter((_, index) =>
    citedLabels.has(`S${index + 1}`)
  );
  const visibleSources = sources.filter((source) => citedLabels.has(source.id));

  return {
    request_id: requestId,
    channel,
    answer: groundedAnswer,
    evidence_status: evidenceStatus,
    conflict_summary: parsed.conflict_summary,
    confidence: confidenceFor(
      citedMatches.length ? citedMatches : chosen,
      evidenceStatus
    ),
    sources: visibleSources,
    retrieval: {
      retrieved: rawMatches.length,
      eligible: ranked.length,
      used: chosen.length,
      min_score: minScore,
      query_count: retrievalPlans.length,
      search_runs: retrievalRuns.length,
      need_count: needs.length,
      coverage_ratio: coverageRatio,
      coverage,
      generation_model: model
    }
  };
}
