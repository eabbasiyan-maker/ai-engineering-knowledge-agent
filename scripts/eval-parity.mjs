const API_BASE =
  process.env.AGENT_URL ||
  "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

const channels = ["api", "web", "telegram"];

const cases = [
  {
    id: "supported",
    question: "How does reflection complement planning in an AI agent?"
  },
  {
    id: "no-evidence",
    question: "What is the recommended orbital insertion burn for a crewed mission to Neptune?"
  }
];

const results = [];
let failed = false;

for (const test of cases) {
  const responses = [];

  for (const channel of channels) {
    const res = await fetch(API_BASE + "/api/v1/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-traffic": "automated_test"
      },
      body: JSON.stringify({
        question: test.question,
        channel,
        top_k: 8
      })
    });

    const body = JSON.parse(await res.text());
    if (!res.ok) {
      failed = true;
      responses.push({ channel, error: "HTTP " + res.status });
      continue;
    }

    responses.push({
      channel,
      evidence_status: body.evidence_status,
      confidence_level: body.confidence?.level ?? null,
      confidence_score: body.confidence?.score ?? null,
      source_ids: Array.isArray(body.sources)
        ? body.sources.map((s) => s.source_id)
        : []
    });
  }

  const baseline = responses.find((x) => x.channel === "api");
  const errors = [];

  const baselineSources = new Set(baseline?.source_ids ?? []);

  for (const response of responses) {
    if (response.error) {
      errors.push(response.channel + ": " + response.error);
      continue;
    }
    if (response.evidence_status !== baseline.evidence_status) {
      errors.push(response.channel + ": evidence_status mismatch");
    }
    if (response.confidence_level !== baseline.confidence_level) {
      errors.push(response.channel + ": confidence_level mismatch");
    }

    if (baseline.evidence_status !== "no_evidence") {
      const responseSources = new Set(response.source_ids ?? []);
      const overlap = [...responseSources].some((id) => baselineSources.has(id));
      if (!overlap) {
        errors.push(response.channel + ": no shared cited source with api baseline");
      }
    } else if ((response.source_ids ?? []).length !== 0) {
      errors.push(response.channel + ": no_evidence returned cited sources");
    }
  }

  if (errors.length) failed = true;

  results.push({
    id: test.id,
    pass: errors.length === 0,
    responses,
    errors
  });
}

console.log(JSON.stringify({ endpoint: API_BASE, results }, null, 2));

if (failed) process.exit(1);
