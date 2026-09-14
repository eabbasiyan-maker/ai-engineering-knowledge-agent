import type { Env } from "./env";

export type CuratorCandidate = {
  title: string;
  author?: string | null;
  publisher?: string | null;
  publication_year?: number | null;
  description?: string | null;
  sample_text?: string | null;
};

const topics = [
  "Foundations",
  "LLM Architecture",
  "Prompt Engineering",
  "Context Engineering",
  "RAG",
  "Knowledge Graph/GraphRAG",
  "AI Agents",
  "Multi-Agent",
  "MCP/Tool Protocols",
  "Evaluation",
  "Reliability",
  "Observability",
  "Security",
  "Governance",
  "Production Architecture",
  "AI Product"
];

export async function reviewCandidate(env: Env, candidate: CuratorCandidate) {
  const rows = await env.DB.prepare(
    "SELECT source_id, title, author, publisher, publication_year, grade, reference_score, status FROM sources ORDER BY source_id"
  ).all();

  return {
    candidate,
    existing_sources: rows.results ?? [],
    human_approval_required: true
  };
}
