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

function buildContext(matches: RankedMatch[], maxChars = 15000) {
  const chosen: RankedMatch[] = [];
  let used = 0;

  for (const match of matches) {
    const text = String(match.text ?? "").trim();
    if (!text) continue;

    const remaining = maxChars - used;
    if (remaining < 500) break;

    const clipped = text.length > remaining ? text.slice(0, remaining) : text;
    chosen.push({ ...match, text: clipped });
    used += clipped.length;
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

function parseModelJson(raw: unknown) {
  const obj = raw as any;
  const choiceContent = obj?.choices?.[0]?.message?.content;

  let text = "";

  if (typeof raw === "string") {
    text = raw;
  } else if (typeof choiceContent === "string") {
    text = choiceContent;
  } else if (Array.isArray(choiceContent)) {
    text = choiceContent.map((part: any) => part?.text ?? "").join("");
  } else if (typeof obj?.response === "string") {
    text = obj.response;
  } else if (obj?.response && typeof obj.response === "object") {
    text = JSON.stringify(obj.response);
  } else if (typeof obj?.result?.response === "string") {
    text = obj.result.response;
  } else if (obj?.result?.response && typeof obj.result.response === "object") {
    text = JSON.stringify(obj.result.response);
  } else if (obj?.answer) {
    text = JSON.stringify(obj);
  }

  const cleaned = text
    .trim()
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/^\`\`\`\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      answer: String(parsed.answer ?? "").trim(),
      conflict: Boolean(parsed.conflict),
      conflict_summary: parsed.conflict_summary ? String(parsed.conflict_summary) : null
    };
  } catch {
    return {
      answer: cleaned,
      conflict: false,
      conflict_summary: null
    };
  }
}

export async function answerQuestion(env: Env, input: AskRequest) {
  const question = String(input.question ?? "").trim();
  const channel: AskChannel = input.channel ?? "api";
  const requestId = crypto.randomUUID();

  const requestedTopK = clamp(Number(input.top_k ?? 8), 3, 12);
  const minScore = clamp(Number(env.MIN_RETRIEVAL_SCORE ?? "0.40"), 0, 1);

  const rawMatches = await searchKnowledge(env, question, requestedTopK);
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
        min_score: minScore
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
Do not expose long verbatim passages; synthesize.
Respond in the language of the user's question.
Return JSON only with exactly:
{"answer":"string","conflict":false,"conflict_summary":null}`;

  const user = `Question:
${question}

Approved evidence:
${context}`;

  const model = env.GENERATION_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";
  const generated = await env.AI.run(
    model as any,
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 900,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            conflict: { type: "boolean" },
            conflict_summary: { type: "string" }
          },
          required: ["answer", "conflict", "conflict_summary"]
        }
      }
    } as any
  ) as any;

  const parsed = parseModelJson(generated);
  const evidenceStatus: EvidenceStatus = parsed.conflict
    ? "conflict"
    : initialEvidenceStatus;

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

  return {
    request_id: requestId,
    channel,
    answer: groundedAnswer,
    evidence_status: evidenceStatus,
    conflict_summary: parsed.conflict_summary,
    confidence: confidenceFor(chosen, evidenceStatus),
    sources,
    retrieval: {
      retrieved: rawMatches.length,
      eligible: ranked.length,
      used: chosen.length,
      min_score: minScore,
      generation_model: model
    }
  };
}
