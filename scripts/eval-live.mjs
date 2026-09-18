import fs from "node:fs/promises";

const API_BASE =
  process.env.AGENT_URL ||
  "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

const cases = JSON.parse(
  await fs.readFile(new URL("../eval/golden-questions.json", import.meta.url), "utf8")
);

const results = [];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function askWithRetry(test) {
  const maxAttempts = 3;
  let lastStatus = null;
  let lastText = "";
  let lastBody = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(API_BASE + "/api/v1/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-traffic": "automated_test"
      },
      body: JSON.stringify({
        question: test.question,
        channel: "api",
        top_k: 8
      })
    });

    lastStatus = res.status;
    lastText = await res.text();

    try {
      lastBody = JSON.parse(lastText);
    } catch {
      lastBody = null;
    }

    if (res.ok && lastBody) {
      return { status: res.status, body: lastBody, attempts: attempt };
    }

    const retryable =
      res.status === 429 ||
      res.status >= 500 ||
      lastBody === null;

    if (!retryable || attempt === maxAttempts) {
      if (lastBody) {
        return { status: res.status, body: lastBody, attempts: attempt };
      }

      throw new Error(
        "HTTP " +
        String(lastStatus ?? "unknown") +
        " returned non-JSON after " +
        attempt +
        " attempt(s): " +
        lastText.slice(0, 120)
      );
    }

    await wait(700 * attempt);
  }

  throw new Error(
    "request failed after retries, last HTTP " + String(lastStatus ?? "unknown")
  );
}

for (const test of cases) {
  const started = Date.now();
  let body = null;
  let httpStatus = null;
  let attempts = 0;
  const errors = [];

  try {
    const response = await askWithRetry(test);
    httpStatus = response.status;
    body = response.body;
    attempts = response.attempts;

    if (httpStatus < 200 || httpStatus >= 300) {
      errors.push("HTTP " + httpStatus);
    }

    if (!test.expected_status.includes(body.evidence_status)) {
      errors.push("unexpected evidence status");
    }

    const sourceIds = Array.isArray(body.sources)
      ? body.sources.map((s) => s.source_id)
      : [];

    for (const expectedSource of test.expected_source_ids) {
      if (!sourceIds.includes(expectedSource)) {
        errors.push("missing expected source " + expectedSource);
      }
    }

    if (body.evidence_status === "no_evidence" && sourceIds.length !== 0) {
      errors.push("no_evidence response returned sources");
    }

    const answerText = String(body.answer ?? "");

    if (
      test.requires_inline_citation &&
      !/\[S\d+\]/.test(answerText)
    ) {
      errors.push("missing inline citation");
    }

    const citationLabels = [];
    for (const match of answerText.matchAll(/\[(S\d+)\]/g)) {
      citationLabels.push(match[1]);
    }

    const returnedLabels = Array.isArray(body.sources)
      ? body.sources.map((source) => source.id)
      : [];

    for (const label of citationLabels) {
      if (!returnedLabels.includes(label)) {
        errors.push("citation missing source metadata: " + label);
      }
    }

    for (const label of returnedLabels) {
      if (!citationLabels.includes(label)) {
        errors.push("uncited source metadata returned: " + label);
      }
    }

    const answerLower = answerText.toLowerCase();

    if (
      Number.isFinite(Number(test.min_answer_chars)) &&
      answerText.trim().length < Number(test.min_answer_chars)
    ) {
      errors.push(
        "answer shorter than min_answer_chars: " +
        answerText.trim().length +
        " < " +
        Number(test.min_answer_chars)
      );
    }

    const citationCount = Array.from(answerText.matchAll(/\[S\d+\]/g)).length;
    if (
      Number.isFinite(Number(test.min_citation_count)) &&
      citationCount < Number(test.min_citation_count)
    ) {
      errors.push(
        "citation count below minimum: " +
        citationCount +
        " < " +
        Number(test.min_citation_count)
      );
    }

    const retrievalNeedCount = Number(body?.retrieval?.need_count ?? 0);
    if (
      Number.isFinite(Number(test.min_need_count)) &&
      retrievalNeedCount < Number(test.min_need_count)
    ) {
      errors.push(
        "need_count below minimum: " +
        retrievalNeedCount +
        " < " +
        Number(test.min_need_count)
      );
    }

    if (
      Number.isFinite(Number(test.max_need_count)) &&
      retrievalNeedCount > Number(test.max_need_count)
    ) {
      errors.push(
        "need_count above maximum: " +
        retrievalNeedCount +
        " > " +
        Number(test.max_need_count)
      );
    }

    const coverageRatio = Number(body?.retrieval?.coverage_ratio ?? 0);
    if (
      Number.isFinite(Number(test.min_coverage_ratio)) &&
      coverageRatio < Number(test.min_coverage_ratio)
    ) {
      errors.push(
        "coverage_ratio below minimum: " +
        coverageRatio +
        " < " +
        Number(test.min_coverage_ratio)
      );
    }

    for (const term of test.required_answer_terms) {
      if (!answerLower.includes(String(term).toLowerCase())) {
        errors.push("missing answer term " + term);
      }
    }

    const anyTerms = Array.isArray(test.required_answer_any_terms)
      ? test.required_answer_any_terms
      : [];
    if (
      anyTerms.length &&
      !anyTerms.some((term) => answerLower.includes(String(term).toLowerCase()))
    ) {
      errors.push("missing any required answer term: " + anyTerms.join(" | "));
    }

    const requiredGroups = Array.isArray(test.required_answer_groups)
      ? test.required_answer_groups
      : [];
    for (const group of requiredGroups) {
      const terms = Array.isArray(group) ? group : [];
      if (
        terms.length &&
        !terms.some((term) => answerLower.includes(String(term).toLowerCase()))
      ) {
        errors.push("missing required concept group: " + terms.join(" | "));
      }
    }

    for (const term of Array.isArray(test.forbidden_answer_terms) ? test.forbidden_answer_terms : []) {
      if (answerLower.includes(String(term).toLowerCase())) {
        errors.push("forbidden answer term " + term);
      }
    }

    const normalizedSentences = answerText
      .split(/[.!?؟\n]+/)
      .map((sentence) =>
        sentence
          .toLowerCase()
          .replace(/\[s\d+\]/g, " ")
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter((sentence) => sentence.length >= 28);

    const seenSentences = new Set();
    for (const sentence of normalizedSentences) {
      if (seenSentences.has(sentence)) {
        errors.push("repeated answer sentence");
        break;
      }
      seenSentences.add(sentence);
    }

    if (
      body.evidence_status !== "no_evidence" &&
      (!body.confidence || typeof body.confidence.score !== "number")
    ) {
      errors.push("missing numeric confidence");
    }

    if (body.evidence_status === "supported" || body.evidence_status === "partial") {
      for (const source of Array.isArray(body.sources) ? body.sources : []) {
        if (Number(source.retrieval_score ?? 0) < 0.5) {
          errors.push("cited source below relevance floor: " + source.id);
        }
      }
    }

    if (!body.request_id) errors.push("missing request_id");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  results.push({
    id: test.id,
    pass: errors.length === 0,
    latency_ms: Date.now() - started,
    http_status: httpStatus,
    attempts,
    evidence_status: body?.evidence_status ?? null,
    confidence: body?.confidence?.score ?? null,
    answer: body?.answer ?? null,
    conflict_summary: body?.conflict_summary ?? null,
    retrieval: body?.retrieval ?? null,
    sources: Array.isArray(body?.sources)
      ? body.sources.map((s) => ({
          id: s.id,
          source_id: s.source_id,
          chunk_id: s.chunk_id,
          section: s.section,
          retrieval_score: s.retrieval_score
        }))
      : [],
    errors
  });
}

const passed = results.filter((r) => r.pass).length;
const total = results.length;
const passRate = total ? passed / total : 0;
const latencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);

const report = {
  generated_at: new Date().toISOString(),
  endpoint: API_BASE,
  summary: {
    passed,
    total,
    pass_rate: Number(passRate.toFixed(3)),
    p95_latency_ms: latencies[p95Index] ?? 0
  },
  results
};

console.log(JSON.stringify(report, null, 2));

if (passRate < 1) process.exit(1);
