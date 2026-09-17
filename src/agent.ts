import type { Env } from "./env";
import { searchKnowledge } from "./search";

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
  return matches
    .filter((m) => Number(m.score ?? 0) >= minScore)
    .map((m) => {
      const vectorScore = Number(m.score ?? 0);
      const gradeWeight = gradeAuthority[String(m.grade ?? "")] ?? 0.5;
      const referenceScore = Number(m.reference_score ?? 50) / 100;
      const authority = gradeWeight * 0.6 + referenceScore * 0.4;
      return {
        ...m,
        score: vectorScore,
        reference_score: Number(m.reference_score ?? 0),
        rank_score: vectorScore * 0.88 + authority * 0.12
      } as RankedMatch;
    })
    .sort((a, b) => b.rank_score - a.rank_score);
}

function chunkOrdinal(chunkId: string) {
  const match = chunkId.match(/C(\d+)$/);
  return match ? Number(match[1]) : null;
}

function buildContext(matches: RankedMatch[], maxChars = 8000, maxChunks = 4) {
  const chosen: RankedMatch[] = [];
  let used = 0;

  const canChoose = (match: RankedMatch) => {
    if (chosen.length >= maxChunks) return false;

    const ordinal = chunkOrdinal(match.chunk_id);
    const isNearDuplicate = chosen.some((existing) => {
      if (existing.source_id !== match.source_id) return false;
      const existingOrdinal = chunkOrdinal(existing.chunk_id);
      return ordinal !== null && existingOrdinal !== null &&
        Math.abs(ordinal - existingOrdinal) <= 1;
    });
    if (isNearDuplicate) return false;

    const text = String(match.text ?? "").trim();
    if (!text) return false;

    const remaining = maxChars - used;
    if (remaining < 500) return false;

    const clipped = text.length > remaining ? text.slice(0, remaining) : text;
    chosen.push({ ...match, text: clipped });
    used += clipped.length;
    return true;
  };

  if (matches.length) canChoose(matches[0]);

  // Prefer independent evidence when another reasonably relevant source exists.
  // This gives the model a chance to detect agreement or conflict instead of
  // filling the whole context with neighboring chunks from one book.
  if (chosen.length && chosen.length < maxChunks) {
    const topScore = chosen[0].score;
    const diversityFloor = Math.max(0.45, topScore - 0.2);
    const seenSources = new Set(chosen.map((m) => m.source_id));

    for (const match of matches) {
      if (chosen.length >= Math.min(maxChunks, 3)) break;
      if (seenSources.has(match.source_id)) continue;
      if (match.score < diversityFloor) continue;
      if (canChoose(match)) seenSources.add(match.source_id);
    }
  }

  for (const match of matches) {
    if (chosen.length >= maxChunks) break;
    if (chosen.some((existing) => existing.chunk_id === match.chunk_id)) continue;
    canChoose(match);
  }

  const context = chosen.map((m, index) => {
    const label = `S${index + 1}`;
    const location = [m.chapter, m.section].filter(Boolean).join(" > ");
    return [
      `[${label}]`,
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

  return { chosen, context };
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

function parseModelJson(raw: unknown) {
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
    return {
      answer: cleaned,
      evidence_status: null,
      conflict: false,
      conflict_summary: null
    };
  }
}

function requestsConflictReview(question: string) {
  return /\b(conflict|conflicting|disagree|disagreement|different perspectives|different views|opposing|both perspectives)\b/i.test(question) ||
    /(اختلاف|متعارض|تعارض|دیدگاه متفاوت|هر دو دیدگاه|مخالف)/.test(question);
}

function mergeRawMatches(groups: any[][]) {
  const merged = new Map<string, any>();

  for (const group of groups) {
    for (const match of group) {
      const key = String(match.chunk_id ?? "");
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing || Number(match.score ?? 0) > Number(existing.score ?? 0)) {
        merged.set(key, match);
      }
    }
  }

  return Array.from(merged.values()).sort(
    (a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)
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
  const retrievalQueries = [question, ...conflictQueries];
  const retrievalGroups = await Promise.all(
    retrievalQueries.map((query) => searchKnowledge(env, query, requestedTopK))
  );
  const rawMatches = mergeRawMatches(retrievalGroups);
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
        query_count: retrievalQueries.length
      }
    };
  }

  const { chosen, context } = buildContext(ranked);
  const initialEvidenceStatus: EvidenceStatus =
    chosen.length >= 2 && chosen[0].score >= 0.52 ? "supported" : "partial";

  const system = `You are the AI Engineering Knowledge Agent.
Answer only from the supplied approved evidence. Do not use outside knowledge.
Distinguish what the evidence supports from inference. If evidence is incomplete, say so.
If supplied sources materially disagree, set conflict=true and explain the disagreement.
Use inline citations like [S1], [S2] for factual claims.
Answer concisely in at most 180 words.
Avoid repetition even when evidence chunks overlap.
Do not expose long verbatim passages; synthesize.
Respond in the language of the user's question.
Judge whether the supplied evidence actually answers the user's question.
If the evidence is only topically related but does not support the requested fact, use evidence_status="no_evidence".
For a single specific fact request (for example an exact score, benchmark result, percentage, date, count, version, or named experiment), if that exact fact is absent from the evidence, use evidence_status="no_evidence", not "partial".
Use evidence_status="partial" only when the user's question has multiple meaningful parts and the evidence directly supports at least one part but not all parts.
If sources materially disagree, use evidence_status="conflict".
Return JSON only with exactly:
{"answer":"string","evidence_status":"supported|partial|no_evidence|conflict","conflict":false,"conflict_summary":null}`;

  const user = `Question:\n${question}\n\nApproved evidence:\n${context}`;

  const model = env.GENERATION_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";
  const generated = await env.AI.run(
    model as any,
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 500,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            answer: { type: "string", maxLength: 2200 },
            evidence_status: {
              type: "string",
              enum: ["supported", "partial", "no_evidence", "conflict"]
            },
            conflict: { type: "boolean" },
            conflict_summary: { type: "string" }
          },
          required: ["answer", "evidence_status", "conflict", "conflict_summary"]
        }
      }
    } as any
  ) as any;

  const parsed = parseModelJson(generated);

  const modelEvidenceStatus: EvidenceStatus =
    parsed.conflict
      ? "conflict"
      : parsed.evidence_status ?? initialEvidenceStatus;

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
        query_count: retrievalQueries.length,
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
    retrieval_score: Number(m.score.toFixed(4))
  }));

  const groundedAnswer = ensureInlineCitation(
    parsed.answer || noEvidenceAnswer(question),
    chosen.length
  );

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
    sources: visibleSources.length ? visibleSources : sources.slice(0, 1),
    retrieval: {
      retrieved: rawMatches.length,
      eligible: ranked.length,
      used: chosen.length,
      min_score: minScore,
      query_count: retrievalQueries.length,
      generation_model: model
    }
  };
}
