import type { Env } from "./env";

type ChunkRow = {
  chunk_id: string;
  source_id: string;
  version_id: string;
  chapter: string | null;
  section: string | null;
  heading_path: string | null;
  chunk_index: number;
  content_hash: string;
  content_text: string;
};

type DomainRule = {
  id: string;
  label: string;
  keywords: string[];
};

export const KNOWLEDGE_DOMAINS: DomainRule[] = [
  {
    id: "agents",
    label: "AI Agent و طراحی Agent",
    keywords: ["ai agent", "agents", "agentic", "planning", "reflection", "reasoning", "agent memory", "tool use", "tool-use"]
  },
  {
    id: "rag-retrieval",
    label: "RAG، Retrieval و Vector Search",
    keywords: ["rag", "retrieval", "retriever", "embedding", "vector search", "vector database", "chunking", "rerank", "reranking"]
  },
  {
    id: "knowledge-graphs",
    label: "Knowledge Graph و GraphRAG",
    keywords: ["knowledge graph", "knowledge graphs", "graphrag", "graph rag", "graph retrieval", "graph database"]
  },
  {
    id: "multi-agent",
    label: "Multi-Agent و Orchestration",
    keywords: ["multi-agent", "multi agent", "multiagent", "agent orchestration", "agent collaboration", "supervisor agent", "swarm"]
  },
  {
    id: "mcp-tools",
    label: "MCP، Tool Calling و Agent Protocols",
    keywords: ["model context protocol", "mcp", "tool calling", "function calling", "tool protocol", "a2a", "agent-to-agent"]
  },
  {
    id: "reliability-evaluation",
    label: "Reliability، Evaluation و Hallucination",
    keywords: ["reliability", "evaluation", "evaluating", "evals", "hallucination", "benchmark", "ground truth", "llm-as-a-judge", "llm as a judge", "testing"]
  },
  {
    id: "security",
    label: "AI Security و Red Teaming",
    keywords: ["security", "prompt injection", "jailbreak", "red teaming", "red-team", "tool attack", "tool attacks", "guardrail", "threat model"]
  },
  {
    id: "production",
    label: "Production Architecture و Observability",
    keywords: ["production", "architecture", "deployment", "observability", "monitoring", "tracing", "latency", "scalability", "rate limit", "rate limiting", "runtime"]
  },
  {
    id: "governance-cost",
    label: "Governance، Compliance و AI Cost",
    keywords: ["governance", "compliance", "policy", "audit", "finops", "cost optimization", "cost management", "budget", "risk management"]
  },
  {
    id: "prompt-context",
    label: "Prompt و Context Engineering",
    keywords: ["prompt engineering", "context engineering", "system prompt", "prompt design", "context window", "context management", "few-shot", "few shot"]
  },
  {
    id: "ai-product",
    label: "AI Product، Strategy و Metrics",
    keywords: ["ai product", "product management", "product strategy", "product manager", "product metrics", "experimentation", "validation", "user research", "product-market fit"]
  }
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordPattern(keyword: string) {
  const escaped = escapeRegex(keyword.toLowerCase());
  if (/^[a-z0-9-]{2,5}$/i.test(keyword)) {
    return `(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`;
  }
  return escaped.replace(/\\ /g, "\\s+");
}

const DOMAIN_MATCHERS = new Map(
  KNOWLEDGE_DOMAINS.map((rule) => [
    rule.id,
    new RegExp(rule.keywords.map(keywordPattern).join("|"), "i")
  ])
);

function parseHeadingPath(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function chunkLabel(row: ChunkRow) {
  const headings = parseHeadingPath(row.heading_path);
  return headings[headings.length - 1]
    || row.section
    || row.chapter
    || `Chunk ${row.chunk_index + 1}`;
}

function classifyChunks(rows: ChunkRow[]) {
  const prepared = rows.map((row) => ({
    row,
    text: [
      row.chapter ?? "",
      row.section ?? "",
      row.heading_path ?? "",
      row.content_text ?? ""
    ].join("\n").toLowerCase()
  }));

  const result = new Map<string, {
    domain_id: string;
    domain_label: string;
    evidence_chunk_count: number;
    sample_chunk_ids: string[];
    sample_sections: string[];
  }>();

  for (const rule of KNOWLEDGE_DOMAINS) {
    let count = 0;
    const sampleIds: string[] = [];
    const sampleSections: string[] = [];
    const seenSections = new Set<string>();
    const matcher = DOMAIN_MATCHERS.get(rule.id)!;

    for (const item of prepared) {
      if (!matcher.test(item.text)) continue;
      count += 1;

      if (sampleIds.length < 5) sampleIds.push(item.row.chunk_id);
      const label = chunkLabel(item.row);
      if (label && !seenSections.has(label) && sampleSections.length < 5) {
        seenSections.add(label);
        sampleSections.push(label);
      }
    }

    // A single incidental mention is too weak to claim domain coverage.
    if (count >= 2) {
      result.set(rule.id, {
        domain_id: rule.id,
        domain_label: rule.label,
        evidence_chunk_count: count,
        sample_chunk_ids: sampleIds,
        sample_sections: sampleSections
      });
    }
  }

  return [...result.values()];
}

async function loadVersionChunks(env: Env, sourceId: string, versionId: string) {
  const rows = await env.DB.prepare(
    `SELECT chunk_id, source_id, version_id, chapter, section, heading_path,
            chunk_index, content_hash, substr(content_text, 1, 700) AS content_text
     FROM knowledge_chunks
     WHERE source_id = ? AND version_id = ?
     ORDER BY chunk_index ASC`
  ).bind(sourceId, versionId).all<ChunkRow>();

  return rows.results ?? [];
}

function subtractByHash(current: ChunkRow[], comparison: ChunkRow[]) {
  const counts = new Map<string, number>();
  for (const row of comparison) {
    counts.set(row.content_hash, (counts.get(row.content_hash) ?? 0) + 1);
  }

  const unmatched: ChunkRow[] = [];
  for (const row of current) {
    const remaining = counts.get(row.content_hash) ?? 0;
    if (remaining > 0) {
      counts.set(row.content_hash, remaining - 1);
    } else {
      unmatched.push(row);
    }
  }
  return unmatched;
}

function summarizeDomains(rows: ChunkRow[]) {
  return classifyChunks(rows)
    .sort((a, b) => b.evidence_chunk_count - a.evidence_chunk_count)
    .slice(0, 6)
    .map((item) => ({
      domain_id: item.domain_id,
      domain_label: item.domain_label,
      evidence_chunk_count: item.evidence_chunk_count,
      sample_chunk_ids: item.sample_chunk_ids.slice(0, 3)
    }));
}

function sampleSections(rows: ChunkRow[]) {
  const seen = new Set<string>();
  const samples: Array<{ chunk_id: string; section: string }> = [];
  for (const row of rows) {
    const label = chunkLabel(row);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    samples.push({ chunk_id: row.chunk_id, section: label });
    if (samples.length >= 8) break;
  }
  return samples;
}

export async function recordVersionKnowledgeProfile(
  env: Env,
  sourceId: string,
  versionId: string,
  previousVersionId: string | null,
  mode: "activation" | "baseline" = "activation"
) {
  const currentRows = await loadVersionChunks(env, sourceId, versionId);
  if (!currentRows.length) {
    throw new Error(`Cannot profile empty source version: ${sourceId}/${versionId}`);
  }

  const profile = classifyChunks(currentRows);
  await env.DB.prepare("DELETE FROM source_version_domains WHERE version_id = ?")
    .bind(versionId)
    .run();

  if (profile.length) {
    await env.DB.batch(
      profile.map((item) => env.DB.prepare(
        `INSERT INTO source_version_domains (
           version_id, source_id, domain_id, domain_label, evidence_chunk_count,
           sample_chunk_ids_json, sample_sections_json, generated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(
        versionId,
        sourceId,
        item.domain_id,
        item.domain_label,
        item.evidence_chunk_count,
        JSON.stringify(item.sample_chunk_ids),
        JSON.stringify(item.sample_sections)
      ))
    );
  }

  const previousRows = previousVersionId
    ? await loadVersionChunks(env, sourceId, previousVersionId)
    : [];

  const addedRows = previousVersionId
    ? subtractByHash(currentRows, previousRows)
    : currentRows;
  const removedRows = previousVersionId
    ? subtractByHash(previousRows, currentRows)
    : [];
  const unchangedCount = Math.max(0, currentRows.length - addedRows.length);

  const changeType = mode === "baseline"
    ? "baseline"
    : previousVersionId
      ? "version_update"
      : "new_source";

  await env.DB.prepare(
    `INSERT INTO knowledge_changes (
       change_id, source_id, previous_version_id, version_id, change_type,
       added_chunk_count, removed_chunk_count, unchanged_chunk_count,
       added_domains_json, removed_domains_json,
       sample_added_json, sample_removed_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(source_id, version_id) DO UPDATE SET
       previous_version_id=excluded.previous_version_id,
       change_type=excluded.change_type,
       added_chunk_count=excluded.added_chunk_count,
       removed_chunk_count=excluded.removed_chunk_count,
       unchanged_chunk_count=excluded.unchanged_chunk_count,
       added_domains_json=excluded.added_domains_json,
       removed_domains_json=excluded.removed_domains_json,
       sample_added_json=excluded.sample_added_json,
       sample_removed_json=excluded.sample_removed_json,
       created_at=CURRENT_TIMESTAMP`
  ).bind(
    crypto.randomUUID(),
    sourceId,
    previousVersionId,
    versionId,
    changeType,
    addedRows.length,
    removedRows.length,
    unchangedCount,
    JSON.stringify(summarizeDomains(addedRows)),
    JSON.stringify(summarizeDomains(removedRows)),
    JSON.stringify(sampleSections(addedRows)),
    JSON.stringify(sampleSections(removedRows))
  ).run();

  return {
    source_id: sourceId,
    version_id: versionId,
    previous_version_id: previousVersionId,
    change_type: changeType,
    domains: profile,
    added_chunk_count: addedRows.length,
    removed_chunk_count: removedRows.length,
    unchanged_chunk_count: unchangedCount
  };
}

async function ensureActiveKnowledgeProfiles(env: Env) {
  const missing = await env.DB.prepare(
    `SELECT sv.source_id, sv.version_id
     FROM source_versions sv
     JOIN sources s ON s.source_id = sv.source_id
     LEFT JOIN knowledge_changes kc
       ON kc.source_id = sv.source_id AND kc.version_id = sv.version_id
     WHERE sv.status = 'active'
       AND sv.activated_at IS NOT NULL
       AND s.status IN ('active', 'active_secondary')
       AND kc.change_id IS NULL
     ORDER BY sv.activated_at ASC`
  ).all<{ source_id: string; version_id: string }>();

  for (const row of missing.results ?? []) {
    await recordVersionKnowledgeProfile(
      env,
      row.source_id,
      row.version_id,
      null,
      "baseline"
    );
  }
}

function gradeWeight(grade: string | null) {
  if (grade === "A") return 1;
  if (grade === "B") return 0.78;
  if (grade === "Supplemental") return 0.5;
  return 0.25;
}

function freshnessWeight(year: number | null, currentYear: number) {
  if (!year) return 0.45;
  if (year >= currentYear - 1) return 1;
  if (year >= currentYear - 3) return 0.75;
  if (year >= currentYear - 5) return 0.55;
  return 0.35;
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

type CoverageRow = {
  domain_id: string;
  domain_label: string;
  evidence_chunk_count: number;
  source_id: string;
  title: string;
  publisher: string | null;
  grade: string;
  reference_score: number | null;
  publication_year: number | null;
  version_id: string;
  activated_at: string | null;
};

async function getCoverage(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT d.domain_id, d.domain_label, d.evidence_chunk_count,
            s.source_id, s.title, s.publisher, s.grade, s.reference_score,
            s.publication_year, sv.version_id, sv.activated_at
     FROM source_version_domains d
     JOIN source_versions sv ON sv.version_id = d.version_id
     JOIN sources s ON s.source_id = d.source_id
     WHERE sv.status = 'active'
       AND sv.activated_at IS NOT NULL
       AND s.status IN ('active', 'active_secondary')
     ORDER BY d.domain_id, s.reference_score DESC, s.source_id`
  ).all<CoverageRow>();

  const activeSourceCount = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM sources
     WHERE status IN ('active', 'active_secondary')`
  ).first<{ count: number }>();

  const byDomain = new Map<string, CoverageRow[]>();
  for (const row of rows.results ?? []) {
    const list = byDomain.get(row.domain_id) ?? [];
    list.push(row);
    byDomain.set(row.domain_id, list);
  }

  const currentYear = new Date().getUTCFullYear();
  const domains = KNOWLEDGE_DOMAINS.map((rule) => {
    const domainRows = byDomain.get(rule.id) ?? [];
    const unique = new Map<string, CoverageRow>();
    for (const row of domainRows) unique.set(row.source_id, row);
    const sources = [...unique.values()];

    const sourceCount = sources.length;
    const independentCount = new Set(
      sources.map((row) => (row.publisher || row.source_id).trim().toLowerCase())
    ).size;
    const evidenceChunks = domainRows.reduce(
      (sum, row) => sum + Number(row.evidence_chunk_count || 0),
      0
    );
    const avgReference = average(
      sources.map((row) => Number(row.reference_score ?? 0)).filter((v) => v > 0)
    );
    const avgGrade = average(sources.map((row) => gradeWeight(row.grade)));
    const freshness = average(
      sources.map((row) => freshnessWeight(row.publication_year, currentYear))
    );

    const score = sourceCount === 0
      ? 0
      : Math.round(
          Math.min(sourceCount / 3, 1) * 25
          + Math.min(independentCount / 3, 1) * 20
          + avgGrade * 15
          + (avgReference / 100) * 15
          + Math.min(evidenceChunks / 50, 1) * 15
          + freshness * 10
        );

    const level = sourceCount === 0
      ? "none"
      : score >= 70 && sourceCount >= 2 && independentCount >= 2
        ? "strong"
        : score >= 45
          ? "medium"
          : "limited";

    const levelLabel = level === "strong"
      ? "پوشش قوی"
      : level === "medium"
        ? "پوشش متوسط"
        : level === "limited"
          ? "پوشش محدود"
          : "فعلاً پوشش قابل اتکا نداریم";

    return {
      domain_id: rule.id,
      domain_label: rule.label,
      coverage_level: level,
      coverage_label: levelLabel,
      coverage_index: score,
      source_count: sourceCount,
      independent_source_count: independentCount,
      evidence_chunk_count: evidenceChunks,
      average_reference_score: avgReference ? Math.round(avgReference) : null,
      active_sources: sources.slice(0, 6).map((row) => ({
        source_id: row.source_id,
        title: row.title,
        grade: row.grade,
        reference_score: row.reference_score,
        version_id: row.version_id,
        publication_year: row.publication_year
      })),
      explanation: sourceCount === 0
        ? "در کتاب‌های فعال فعلی شواهد مستقیم کافی برای این حوزه پیدا نشده است."
        : `${sourceCount} منبع فعال، ${independentCount} ناشر/منبع مستقل و ${evidenceChunks} Chunk دارای نشانه مستقیم از این حوزه.`
    };
  }).sort((a, b) => b.coverage_index - a.coverage_index);

  return {
    generated_at: new Date().toISOString(),
    active_source_count: Number(activeSourceCount?.count ?? 0),
    interpretation: "قدرت پوشش یعنی مقدار و تنوع شواهد موجود در کتابخانه؛ احتمال درست‌بودن هر پاسخ نیست.",
    domains
  };
}

function parseJsonArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type ChangeRow = {
  change_id: string;
  source_id: string;
  title: string;
  previous_version_id: string | null;
  version_id: string;
  change_type: string;
  added_chunk_count: number;
  removed_chunk_count: number;
  unchanged_chunk_count: number;
  added_domains_json: string;
  removed_domains_json: string;
  sample_added_json: string;
  sample_removed_json: string;
  activated_at: string | null;
};

async function getChanges(env: Env, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit || 10)));
  const rows = await env.DB.prepare(
    `SELECT kc.change_id, kc.source_id, s.title,
            kc.previous_version_id, kc.version_id, kc.change_type,
            kc.added_chunk_count, kc.removed_chunk_count,
            kc.unchanged_chunk_count, kc.added_domains_json,
            kc.removed_domains_json, kc.sample_added_json,
            kc.sample_removed_json, sv.activated_at
     FROM knowledge_changes kc
     JOIN sources s ON s.source_id = kc.source_id
     JOIN source_versions sv ON sv.version_id = kc.version_id
     WHERE sv.activated_at IS NOT NULL
       AND kc.change_type <> 'baseline'
     ORDER BY datetime(sv.activated_at) DESC, kc.created_at DESC
     LIMIT ?`
  ).bind(safeLimit).all<ChangeRow>();

  const baseline = await env.DB.prepare(
    `SELECT COUNT(DISTINCT s.source_id) AS source_count,
            COUNT(DISTINCT sv.version_id) AS version_count,
            SUM(CASE WHEN k.status='active' THEN 1 ELSE 0 END) AS chunk_count,
            MAX(sv.activated_at) AS latest_activation
     FROM sources s
     JOIN source_versions sv ON sv.source_id = s.source_id AND sv.status='active'
     LEFT JOIN knowledge_chunks k ON k.version_id = sv.version_id
     WHERE s.status IN ('active', 'active_secondary')`
  ).first<{
    source_count: number;
    version_count: number;
    chunk_count: number;
    latest_activation: string | null;
  }>();

  return {
    baseline: {
      source_count: Number(baseline?.source_count ?? 0),
      version_count: Number(baseline?.version_count ?? 0),
      chunk_count: Number(baseline?.chunk_count ?? 0),
      latest_activation: baseline?.latest_activation ?? null,
      note: "این خط مبنا وضعیت فعلی کتابخانه است. تغییرهای بعدی کتاب‌ها از این نقطه به بعد به‌صورت نسخه‌محور ثبت می‌شوند."
    },
    changes: (rows.results ?? []).map((row) => ({
      change_id: row.change_id,
      source_id: row.source_id,
      title: row.title,
      previous_version_id: row.previous_version_id,
      version_id: row.version_id,
      change_type: row.change_type,
      activated_at: row.activated_at,
      added_chunk_count: Number(row.added_chunk_count ?? 0),
      removed_chunk_count: Number(row.removed_chunk_count ?? 0),
      unchanged_chunk_count: Number(row.unchanged_chunk_count ?? 0),
      added_domains: parseJsonArray(row.added_domains_json),
      removed_domains: parseJsonArray(row.removed_domains_json),
      sample_added_sections: parseJsonArray(row.sample_added_json),
      sample_removed_sections: parseJsonArray(row.sample_removed_json)
    }))
  };
}

export async function getKnowledgeOverview(env: Env, limit = 10) {
  await ensureActiveKnowledgeProfiles(env);
  const [coverage, changes] = await Promise.all([
    getCoverage(env),
    getChanges(env, limit)
  ]);

  return { coverage, changes };
}
