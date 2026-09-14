const API =
  process.env.AGENT_URL ||
  "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev/api/v1/ask";

const questions = [
  "How should an AI agent handle complex multi-step tasks and recover from failures?",
  "What makes an AI agent reliable in production?",
  "How do planning, reflection, evaluation, and monitoring improve agent reliability?",
  "What are the main limitations of reactive ReAct-style agents on complex tasks?",
  "How should AI agents use tools safely and recover when tool calls fail?"
];

for (const question of questions) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, channel: "api", top_k: 12 })
  });
  const body = await res.json();
  console.log(JSON.stringify({
    question,
    status: body.evidence_status,
    confidence: body.confidence?.score ?? null,
    sources: (body.sources || []).map((s) => ({
      id: s.id,
      source_id: s.source_id,
      section: s.section,
      retrieval_score: s.retrieval_score
    })),
    answer: body.answer
  }, null, 2));
}
