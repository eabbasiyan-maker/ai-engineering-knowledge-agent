import type { Env } from "./env";

type RequestAnalyticsInput = {
  request_id: string;
  channel: string;
  question: string;
  evidence_status: string;
  confidence_score?: number | null;
  source_count: number;
  latency_ms?: number | null;
};

type AnalyticsRow = {
  request_id?: string | null;
  channel?: string | null;
  question_hash?: string | null;
  question_preview?: string | null;
  evidence_status?: string | null;
  confidence_score?: number | null;
  source_count?: number | null;
  latency_ms?: number | null;
  created_at?: string | null;
};

const AUTOMATED_TEST_QUESTIONS = [
  "What are common ReAct failure modes and how can they be mitigated?",
  "How does reflection complement planning in an AI agent?",
  "How can a ReAct-style agent recover when a tool call fails?",
  "What are the limitations of the ReAct pattern?",
  "Reflection در AI Agent چه کاربردی دارد؟",
  "What is the recommended orbital insertion burn for a crewed mission to Neptune?",
  "According to the approved knowledge base, what exact accuracy percentage did ReAct achieve on the Mars Rover Benchmark?",
  "What exact percentage latency reduction does reflection provide compared with plain ReAct?",
  "Compare these two approved-source definitions explicitly. An Illustrated Guide to AI Agents describes an LLM-backed agent as a reasoning LLM augmented with memory, tools, planning, and reflection. Production-Grade Agentic AI says 'Real agents aren't LLM + Tools' and defines real agents as persistent autonomous distributed applications that maintain state and pursue goals independently. Are these definitions materially in conflict about what counts as an AI agent? Explain the disagreement and cite both sources.",
  "What are common ReAct failure modes?"
];

function normalizeQuestion(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function redactPreview(value: string) {
  return normalizeQuestion(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone]")
    .slice(0, 240);
}

const automatedTestPreviews = new Set(
  AUTOMATED_TEST_QUESTIONS.map((question) => redactPreview(question).toLowerCase())
);

function isAutomatedTestRow(row: AnalyticsRow) {
  const channel = String(row.channel ?? "").toLowerCase();
  if (channel.startsWith("test_")) return true;

  const preview = redactPreview(String(row.question_preview ?? "")).toLowerCase();
  return preview.length > 0 && automatedTestPreviews.has(preview);
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function recordAgentRequest(
  env: Env,
  input: RequestAnalyticsInput
) {
  const normalized = normalizeQuestion(input.question);
  const questionHash = await sha256Hex(normalized.toLowerCase());
  const preview = redactPreview(normalized);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO agent_requests
      (request_id, channel, question_hash, question_preview, evidence_status,
       confidence_score, source_count, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    input.request_id,
    input.channel,
    questionHash,
    preview || null,
    input.evidence_status,
    input.confidence_score ?? null,
    input.source_count,
    input.latency_ms ?? null
  ).run();
}

function cutoffIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function numberValue(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function summarizeRows(rows: AnalyticsRow[]) {
  const latencies = rows
    .map((row) => numberValue(row.latency_ms))
    .filter((value) => value > 0);

  const countStatus = (status: string) =>
    rows.filter((row) => String(row.evidence_status ?? "") === status).length;

  const supported = countStatus("supported");
  const partial = countStatus("partial");
  const noEvidence = countStatus("no_evidence");
  const conflict = countStatus("conflict");
  const reviewNeeded = rows.filter((row) => {
    const status = String(row.evidence_status ?? "");
    const confidence = row.confidence_score;
    return confidence == null || numberValue(confidence) < 0.60 ||
      status === "partial" || status === "no_evidence" || status === "conflict";
  }).length;

  return {
    request_count: rows.length,
    avg_latency_ms: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : 0,
    supported_count: supported,
    partial_count: partial,
    no_evidence_count: noEvidence,
    conflict_count: conflict,
    review_needed_count: reviewNeeded,
    supported_rate: rows.length ? Number((supported / rows.length).toFixed(3)) : null
  };
}

function groupedCounts(rows: AnalyticsRow[], key: "channel" | "evidence_status") {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = String(row[key] ?? "unknown").replace(/^test_/, "");
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ [key]: value, count }))
    .sort((a, b) => b.count - a.count);
}

function groupedQuestions(rows: AnalyticsRow[], onlyNoEvidence = false) {
  const grouped = new Map<string, {
    question_hash: string;
    question_preview: string;
    count: number;
    last_seen: string;
  }>();

  for (const row of rows) {
    if (onlyNoEvidence && row.evidence_status !== "no_evidence") continue;
    const hash = String(row.question_hash ?? "");
    if (!hash) continue;
    const existing = grouped.get(hash);
    const createdAt = String(row.created_at ?? "");
    if (!existing) {
      grouped.set(hash, {
        question_hash: hash,
        question_preview: String(row.question_preview ?? ""),
        count: 1,
        last_seen: createdAt
      });
    } else {
      existing.count += 1;
      if (createdAt > existing.last_seen) {
        existing.last_seen = createdAt;
        existing.question_preview = String(row.question_preview ?? existing.question_preview);
      }
    }
  }

  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen))
    .slice(0, onlyNoEvidence ? 30 : 20);
}

export async function getAnalyticsSummary(env: Env, requestedDays = 30) {
  const days = Math.min(Math.max(Math.floor(requestedDays || 30), 1), 365);
  const cutoff = cutoffIso(days);

  const requestRowsResult = await env.DB.prepare(
    `SELECT
       request_id, channel, question_hash, question_preview, evidence_status,
       confidence_score, source_count, latency_ms, created_at
     FROM agent_requests
     WHERE created_at >= ?
     ORDER BY created_at DESC
     LIMIT 5000`
  ).bind(cutoff).all<AnalyticsRow>();

  const allRows = requestRowsResult.results ?? [];
  const automatedRows = allRows.filter(isAutomatedTestRow);
  const userRows = allRows.filter((row) => !isAutomatedTestRow(row));

  const lowConfidence = userRows.filter((row) => {
    const status = String(row.evidence_status ?? "");
    return row.confidence_score == null || numberValue(row.confidence_score) < 0.60 ||
      status === "partial" || status === "no_evidence" || status === "conflict";
  }).slice(0, 50);

  const feedbackRowsResult = await env.DB.prepare(
    `SELECT
       f.helpful, f.created_at,
       r.channel, r.question_preview
     FROM answer_feedback f
     LEFT JOIN agent_requests r ON r.request_id = f.request_id
     WHERE f.created_at >= ?
     ORDER BY f.created_at DESC
     LIMIT 5000`
  ).bind(cutoff).all<Record<string, unknown>>();

  const feedbackRows = (feedbackRowsResult.results ?? []).filter((row) =>
    !isAutomatedTestRow({
      channel: String(row.channel ?? ""),
      question_preview: String(row.question_preview ?? "")
    })
  );

  const feedback = {
    total: feedbackRows.length,
    helpful: feedbackRows.filter((row) => numberValue(row.helpful) === 1).length,
    not_helpful: feedbackRows.filter((row) => numberValue(row.helpful) === 0).length
  };

  return {
    days,
    cutoff,
    scope_note: "User-facing analytics exclude known automated evaluation and smoke-test traffic. Confidence is an evidence-strength heuristic, not a probability of truth.",
    traffic: {
      user_requests: userRows.length,
      automated_test_requests: automatedRows.length,
      total_logged_requests: allRows.length,
      historical_test_detection: "Known pre-tagging evaluation questions are excluded by exact redacted-preview match. New automated tests are tagged explicitly."
    },
    totals: summarizeRows(userRows),
    channels: groupedCounts(userRows, "channel"),
    evidence_statuses: groupedCounts(userRows, "evidence_status"),
    top_questions: groupedQuestions(userRows),
    low_confidence: lowConfidence,
    missing_topics: groupedQuestions(userRows, true),
    feedback,
    automated_tests: {
      totals: summarizeRows(automatedRows),
      evidence_statuses: groupedCounts(automatedRows, "evidence_status")
    },
    data_limited_to_5000_rows: allRows.length >= 5000
  };
}
