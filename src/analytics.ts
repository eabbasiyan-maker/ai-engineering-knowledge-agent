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

function normalizeQuestion(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function redactPreview(value: string) {
  return normalizeQuestion(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone]")
    .slice(0, 240);
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

export async function getAnalyticsSummary(env: Env, requestedDays = 30) {
  const days = Math.min(Math.max(Math.floor(requestedDays || 30), 1), 365);
  const cutoff = cutoffIso(days);

  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS request_count,
       AVG(latency_ms) AS avg_latency_ms,
       SUM(CASE WHEN evidence_status = 'no_evidence' THEN 1 ELSE 0 END) AS no_evidence_count,
       SUM(CASE WHEN evidence_status = 'partial' THEN 1 ELSE 0 END) AS partial_count,
       SUM(CASE WHEN evidence_status = 'conflict' THEN 1 ELSE 0 END) AS conflict_count
     FROM agent_requests
     WHERE created_at >= ?`
  ).bind(cutoff).first<Record<string, unknown>>();

  const channels = await env.DB.prepare(
    `SELECT channel, COUNT(*) AS count
     FROM agent_requests
     WHERE created_at >= ?
     GROUP BY channel
     ORDER BY count DESC`
  ).bind(cutoff).all();

  const statuses = await env.DB.prepare(
    `SELECT evidence_status, COUNT(*) AS count
     FROM agent_requests
     WHERE created_at >= ?
     GROUP BY evidence_status
     ORDER BY count DESC`
  ).bind(cutoff).all();

  const topQuestions = await env.DB.prepare(
    `SELECT
       question_hash,
       MAX(question_preview) AS question_preview,
       COUNT(*) AS count,
       MAX(created_at) AS last_seen
     FROM agent_requests
     WHERE created_at >= ?
     GROUP BY question_hash
     ORDER BY count DESC, last_seen DESC
     LIMIT 20`
  ).bind(cutoff).all();

  const lowConfidence = await env.DB.prepare(
    `SELECT
       request_id, channel, question_preview, evidence_status,
       confidence_score, source_count, latency_ms, created_at
     FROM agent_requests
     WHERE created_at >= ?
       AND (
         confidence_score IS NULL
         OR confidence_score < 0.60
         OR evidence_status IN ('partial', 'no_evidence', 'conflict')
       )
     ORDER BY created_at DESC
     LIMIT 50`
  ).bind(cutoff).all();

  const missingTopics = await env.DB.prepare(
    `SELECT
       question_hash,
       MAX(question_preview) AS question_preview,
       COUNT(*) AS count,
       MAX(created_at) AS last_seen
     FROM agent_requests
     WHERE created_at >= ?
       AND evidence_status = 'no_evidence'
     GROUP BY question_hash
     ORDER BY count DESC, last_seen DESC
     LIMIT 30`
  ).bind(cutoff).all();

  const feedback = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN helpful = 1 THEN 1 ELSE 0 END) AS helpful,
       SUM(CASE WHEN helpful = 0 THEN 1 ELSE 0 END) AS not_helpful
     FROM answer_feedback
     WHERE created_at >= ?`
  ).bind(cutoff).first<Record<string, unknown>>();

  return {
    days,
    cutoff,
    totals: totals ?? {},
    channels: channels.results ?? [],
    evidence_statuses: statuses.results ?? [],
    top_questions: topQuestions.results ?? [],
    low_confidence: lowConfidence.results ?? [],
    missing_topics: missingTopics.results ?? [],
    feedback: feedback ?? {}
  };
}
