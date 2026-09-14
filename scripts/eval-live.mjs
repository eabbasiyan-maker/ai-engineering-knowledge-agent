import fs from "node:fs/promises";

const API_BASE =
  process.env.AGENT_URL ||
  "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

const cases = JSON.parse(
  await fs.readFile(new URL("../eval/golden-questions.json", import.meta.url), "utf8")
);

const results = [];

for (const test of cases) {
  const started = Date.now();
  let body = null;
  let httpStatus = null;
  const errors = [];

  try {
    const res = await fetch(API_BASE + "/api/v1/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: test.question,
        channel: "api",
        top_k: 8
      })
    });

    httpStatus = res.status;
    body = JSON.parse(await res.text());

    if (!res.ok) errors.push("HTTP " + res.status);

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

    if (
      test.requires_inline_citation &&
      !/\[S\d+\]/.test(String(body.answer ?? ""))
    ) {
      errors.push("missing inline citation");
    }

    const answerLower = String(body.answer ?? "").toLowerCase();
    for (const term of test.required_answer_terms) {
      if (!answerLower.includes(String(term).toLowerCase())) {
        errors.push("missing answer term " + term);
      }
    }

    if (
      body.evidence_status !== "no_evidence" &&
      (!body.confidence || typeof body.confidence.score !== "number")
    ) {
      errors.push("missing numeric confidence");
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
    evidence_status: body?.evidence_status ?? null,
    confidence: body?.confidence?.score ?? null,
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
