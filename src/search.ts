import type { Env } from "./env";

function requestsConflictReviewQuery(query: string) {
  return /\b(conflict|conflicting|disagree|disagreement|different perspectives|different views|opposing|both perspectives)\b/i.test(query) ||
    /(اختلاف|متعارض|تعارض|دیدگاه متفاوت|هر دو دیدگاه|مخالف)/.test(query);
}

function extractExactFactAnchor(query: string) {
  if (!/\b(exact|percentage|percent|benchmark|score|date|count|version)\b/i.test(query)) {
    return null;
  }

  const phrases = query.match(/\b(?:[A-Z][A-Za-z0-9-]*\s+){1,}[A-Z][A-Za-z0-9-]*\b/g) ?? [];
  if (!phrases.length) return null;

  const anchor = phrases.sort((a, b) => b.length - a.length)[0];
  return anchor ? anchor.trim().toLowerCase() : null;
}

async function exactAnchorRescue(env: Env, anchor: string) {
  const pattern = `%${anchor}%`;
  const row = await env.DB.prepare(
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
       AND (
         lower(COALESCE(k.content_text, '')) LIKE ? OR
         lower(COALESCE(k.section, '')) LIKE ? OR
         lower(COALESCE(s.title, '')) LIKE ?
       )
     LIMIT 1`
  ).bind(pattern, pattern, pattern).first<Record<string, unknown>>();

  if (!row || !row.content_text) return null;

  return {
    score: 0.62,
    chunk_id: row.chunk_id,
    source_id: row.source_id,
    version_id: row.version_id,
    title: row.title,
    grade: row.grade,
    reference_score: row.reference_score,
    chapter: row.chapter,
    section: row.section,
    text: String(row.content_text),
    retrieval_kind: "exact_anchor"
  };
}

function mergeMatches(groups: any[][]) {
  const merged = new Map<string, any>();
  for (const group of groups) {
    for (const match of group) {
      const key = String(match.chunk_id ?? "");
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing || Number(match.score ?? 0) > Number(existing.score ?? 0)) {
        merged.set(key, match);
      }
    }
  }
  return Array.from(merged.values()).sort(
    (a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)
  );
}

const lexicalStopwords = new Set([
  "about", "after", "again", "against", "also", "approved", "both", "could",
  "different", "does", "from", "fundamentally", "have", "into", "materially",
  "more", "other", "perspective", "perspectives", "question", "sources", "state",
  "that", "their", "these", "they", "this", "those", "what", "when", "where",
  "which", "with", "would", "explicitly", "cite", "disagree", "disagreement",
  "whether", "compatible", "first", "second", "true", "false", "position",
  "says", "describes", "compare", "using", "production-grade",
  "برای", "اگر", "منابع", "دیدگاه", "متفاوت", "اختلاف", "صریح", "کن", "بگو"
]);

function lexicalTerms(query: string) {
  const tokens = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu) ?? [];

  const unique = Array.from(new Set(tokens))
    .filter((token) => token.length >= 4 && !lexicalStopwords.has(token));

  return unique
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
}

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchMentionedSourceEvidence(env: Env, query: string) {
  const catalog = await env.DB.prepare(
    `SELECT source_id, title, grade, reference_score
       FROM sources
      WHERE status IN ('active', 'active_secondary')`
  ).all<Record<string, unknown>>();

  const normalizedQuery = normalizeForMatch(query);
  const mentioned = (catalog.results ?? []).filter((source) => {
    const title = normalizeForMatch(String(source.title ?? ""));
    return title.length >= 8 && normalizedQuery.includes(title);
  });

  if (!mentioned.length) return [] as any[];

  const terms = lexicalTerms(query);
  if (!terms.length) return [] as any[];

  const results: any[] = [];

  for (const source of mentioned.slice(0, 4)) {
    const sourceId = String(source.source_id ?? "");
    if (!sourceId) continue;

    const predicates: string[] = [];
    const binds: string[] = [sourceId];

    for (const term of terms) {
      predicates.push(`(
        lower(COALESCE(k.content_text, '')) LIKE ? OR
        lower(COALESCE(k.section, '')) LIKE ?
      )`);
      const pattern = `%${term}%`;
      binds.push(pattern, pattern);
    }

    const rows = await env.DB.prepare(
      `SELECT
          k.chunk_id, k.source_id, k.version_id, k.chapter, k.section,
          k.content_text,
          s.title, s.grade, s.reference_score
       FROM knowledge_chunks k
       JOIN sources s ON s.source_id = k.source_id
       JOIN source_versions v ON v.version_id = k.version_id
       WHERE k.source_id = ?
         AND k.status = 'active'
         AND v.status = 'active'
         AND s.status IN ('active', 'active_secondary')
         AND (${predicates.join(" OR ")})
       LIMIT 220`
    ).bind(...binds).all<Record<string, unknown>>();

    const scored = (rows.results ?? [])
      .map((row) => {
        const text = String(row.content_text ?? "");
        const heading = String(row.section ?? "").toLowerCase();
        const haystack = `${heading} ${text}`.toLowerCase();
        const hits = terms.filter((term) => haystack.includes(term));
        const headingHits = terms.filter((term) => heading.includes(term)).length;
        const coverage = hits.length / terms.length;
        const score = Math.min(0.76, 0.58 + coverage * 0.16 + headingHits * 0.02);

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
          lexical_hits: hits.length,
          retrieval_kind: "named_source"
        };
      })
      .filter((row) => row.lexical_hits >= 1 && row.text)
      .sort((a, b) =>
        Number(b.lexical_hits) - Number(a.lexical_hits) ||
        Number(b.score) - Number(a.score)
      )
      .slice(0, 2);

    results.push(...scored);
  }

  return results;
}

export async function searchKnowledge(env: Env, query: string, topK = 8) {
  const embedded = await env.AI.run(
    (env.EMBEDDING_MODEL || "@cf/baai/bge-m3") as any,
    { text: [query] } as any
  ) as any;

  const vector = embedded?.data?.[0] as number[] | undefined;
  if (!vector) throw new Error("Failed to embed query");

  const result = await env.VECTORIZE.query(vector, {
    topK: Math.min(Math.max(topK * 8, 24), 100),
    returnMetadata: "none"
  });

  const accepted: any[] = [];
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
      text,
      retrieval_kind: "vector"
    });

    if (accepted.length >= eligibleTarget) break;
  }

  const exactAnchor = extractExactFactAnchor(query);
  if (exactAnchor) {
    const semanticHasAnchor = accepted.some((match) => {
      const haystack = `${String(match.title ?? "")} ${String(match.section ?? "")} ${String(match.text ?? "")}`.toLowerCase();
      return haystack.includes(exactAnchor);
    });

    if (!semanticHasAnchor) {
      const rescued = await exactAnchorRescue(env, exactAnchor);
      if (!rescued) return [];
      accepted.unshift(rescued);
    }
  }

  if (!requestsConflictReviewQuery(query)) return accepted;

  const [namedSources, lexical] = await Promise.all([
    searchMentionedSourceEvidence(env, query),
    searchKnowledgeLexical(env, query, topK)
  ]);

  return mergeMatches([namedSources, accepted, lexical]);
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
      const score = Math.min(0.78, 0.46 + coverage * 0.28 + headingHits * 0.025);

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
        lexical_hits: hits.length,
        retrieval_kind: "lexical"
      };
    })
    .filter((row) => row.lexical_hits >= 1 && row.text)
    .sort((a, b) =>
      Number(b.lexical_hits) - Number(a.lexical_hits) ||
      Number(b.score) - Number(a.score)
    );

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
