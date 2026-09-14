import type { Env } from "./env";

export async function searchKnowledge(env: Env, query: string, topK = 8) {
  const embedded = await env.AI.run(
    (env.EMBEDDING_MODEL || "@cf/baai/bge-m3") as any,
    { text: [query] } as any
  ) as any;

  const vector = embedded?.data?.[0] as number[] | undefined;
  if (!vector) throw new Error("Failed to embed query");

  const result = await env.VECTORIZE.query(vector, {
    topK: Math.min(Math.max(topK * 3, 12), 40),
    returnMetadata: "all"
  });

  const accepted = [];

  for (const match of result.matches ?? []) {
    const chunkId = String(match.id);
    const row = await env.DB.prepare(
      `SELECT
          k.chunk_id, k.source_id, k.version_id, k.chapter, k.section,
          k.content_text, k.r2_text_key,
          s.title, s.grade, s.status, v.status AS version_status
       FROM knowledge_chunks k
       JOIN sources s ON s.source_id = k.source_id
       JOIN source_versions v ON v.version_id = k.version_id
       WHERE k.chunk_id = ?
         AND k.status = 'active'
         AND v.status = 'active'
         AND s.status IN ('active', 'active_secondary')`
    ).bind(chunkId).first<Record<string, unknown>>();

    if (!row) continue;

    let text = String(row.content_text ?? "");

    // Backward-compatible fallback for older R2-backed rows.
    if (!text && env.KNOWLEDGE_R2 && row.r2_text_key) {
      const key = String(row.r2_text_key);
      if (!key.startsWith("d1://")) {
        const object = await env.KNOWLEDGE_R2.get(key);
        if (object) text = await object.text();
      }
    }

    if (!text) continue;

    accepted.push({
      score: match.score,
      chunk_id: row.chunk_id,
      source_id: row.source_id,
      title: row.title,
      grade: row.grade,
      chapter: row.chapter,
      section: row.section,
      text
    });

    if (accepted.length >= topK) break;
  }

  return accepted;
}
