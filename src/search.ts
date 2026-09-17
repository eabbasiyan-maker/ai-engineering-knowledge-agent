import type { Env } from "./env";

export async function searchKnowledge(env: Env, query: string, topK = 8) {
  const embedded = await env.AI.run(
    (env.EMBEDDING_MODEL || "@cf/baai/bge-m3") as any,
    { text: [query] } as any
  ) as any;

  const vector = embedded?.data?.[0] as number[] | undefined;
  if (!vector) throw new Error("Failed to embed query");

  const result = await env.VECTORIZE.query(vector, {
    // Search a wider candidate pool because Vectorize deletions are asynchronous.
    // D1 remains the final eligibility authority.
    topK: Math.min(Math.max(topK * 8, 24), 100),
    returnMetadata: "none"
  });

  const accepted = [];
  const eligibleTarget = Math.min(Math.max(topK * 3, 24), 36);

  for (const match of result.matches ?? []) {
    const chunkId = String(match.id);
    const row = await env.DB.prepare(
      `SELECT
          k.chunk_id, k.source_id, k.version_id, k.chapter, k.section,
          k.content_text, k.r2_text_key,
          s.title, s.grade, s.reference_score, s.status, v.status AS version_status
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
      version_id: row.version_id,
      title: row.title,
      grade: row.grade,
      reference_score: row.reference_score,
      chapter: row.chapter,
      section: row.section,
      text
    });

    // Keep a broader eligible set so the context builder can deliberately
    // include independent sources instead of being dominated by one book.
    if (accepted.length >= eligibleTarget) break;
  }

  return accepted;
}

const lexicalStopwords = new Set([
  "about", "after", "again", "against", "also", "approved", "both", "could",
  "different", "does", "from", "fundamentally", "have", "into", "materially",
  "more", "other", "perspective", "perspectives", "question", "sources", "state",
  "that", "their", "these", "they", "this", "those", "what", "when", "where",
  "which", "with", "would", "explicitly", "cite", "disagree", "disagreement",
  "whether", "compatible", "first", "second", "true", "false", "position",
  "برای", "اگر", "منابع", "دیدگاه", "متفاوت", "اختلاف", "صریح", "کن", "بگو"
]);

function lexicalTerms(query: string) {
  const tokens = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu) ?? [];

  const unique = Array.from(new Set(tokens))
    .filter((token) => token.length >= 4 && !lexicalStopwords.has(token));

  // Prefer more distinctive terms but preserve enough of the original topic.
  return unique
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

export async function searchKnowledgeLexical(env: Env, query: string, topK = 12) {
  const terms = lexicalTerms(query);
  if (!terms.length) return [] as any[];

  const predicates: string[] = [];
  const binds: string[] = [];

  for (const term of terms) {
    predicates.push(`(
      lower(COALESCE(k.content_text, '')) LIKE ? OR
      lower(COALESCE(k.section, '')) LIKE ? OR
      lower(COALESCE(s.title, '')) LIKE ?
    )`);
    const pattern = `%${term}%`;
    binds.push(pattern, pattern, pattern);
  }

  const rows = await env.DB.prepare(
    `SELECT
        k.chunk_id, k.source_id, k.version_id, k.chapter, k.section,
        k.content_text,
        s.title, s.grade, s.reference_score
     FROM knowledge_chunks k
     JOIN sources s ON s.source_id = k.source_id
     JOIN source_versions v ON v.version_id = k.version_id
     WHERE k.status = 'active'
       AND v.status = 'active'
       AND s.status IN ('active', 'active_secondary')
       AND (${predicates.join(" OR ")})
     LIMIT 300`
  ).bind(...binds).all<Record<string, unknown>>();

  const scored = (rows.results ?? [])
    .map((row) => {
      const text = String(row.content_text ?? "");
      const heading = `${String(row.title ?? "")} ${String(row.section ?? "")}`.toLowerCase();
      const haystack = `${heading} ${text}`.toLowerCase();
      const hits = terms.filter((term) => haystack.includes(term));
      const headingHits = terms.filter((term) => heading.includes(term)).length;
      const coverage = hits.length / terms.length;
      const score = Math.min(0.78, 0.42 + coverage * 0.28 + headingHits * 0.025);

      return {
        score,
        chunk_id: row.chunk_id,
        source_id: row.source_id,
        version_id: row.version_id,
        title: row.title,
        grade: row.grade,
        reference_score: row.reference_score,
        chapter: row.chapter,
        section: row.section,
        text,
        lexical_hits: hits.length
      };
    })
    .filter((row) => row.lexical_hits >= 1 && row.text)
    .sort((a, b) =>
      Number(b.lexical_hits) - Number(a.lexical_hits) ||
      Number(b.score) - Number(a.score)
    );

  // Prevent a single source from monopolizing lexical rescue results.
  const perSource = new Map<string, number>();
  const diversified: any[] = [];
  const target = Math.min(Math.max(topK * 2, 16), 30);

  for (const row of scored) {
    const sourceId = String(row.source_id ?? "");
    const count = perSource.get(sourceId) ?? 0;
    if (count >= 2) continue;
    diversified.push(row);
    perSource.set(sourceId, count + 1);
    if (diversified.length >= target) break;
  }

  return diversified;
}
