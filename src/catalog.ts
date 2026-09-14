import type { Env } from "./env";

export type SourceStatus =
  | "incoming"
  | "approved"
  | "active"
  | "active_secondary"
  | "disabled"
  | "archived"
  | "rejected";

export interface SourceInput {
  source_id: string;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  publisher?: string | null;
  publication_year?: number | null;
  edition?: string | null;
  source_type?: string;
  grade: "A" | "B" | "Supplemental" | "Reject";
  reference_score?: number | null;
  status: SourceStatus;
  seed?: boolean;
  original_provider?: string;
  original_file_id?: string | null;
  original_folder?: string | null;
  topics?: string[];
}

export async function upsertSource(env: Env, input: SourceInput) {
  await env.DB.prepare(
    `INSERT INTO sources (
      source_id, title, subtitle, author, publisher, publication_year, edition,
      source_type, grade, reference_score, status, seed, original_provider,
      original_file_id, original_folder, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(source_id) DO UPDATE SET
      title=excluded.title,
      subtitle=excluded.subtitle,
      author=excluded.author,
      publisher=excluded.publisher,
      publication_year=excluded.publication_year,
      edition=excluded.edition,
      source_type=excluded.source_type,
      grade=excluded.grade,
      reference_score=excluded.reference_score,
      status=excluded.status,
      seed=excluded.seed,
      original_provider=excluded.original_provider,
      original_file_id=excluded.original_file_id,
      original_folder=excluded.original_folder,
      updated_at=CURRENT_TIMESTAMP`
  ).bind(
    input.source_id,
    input.title,
    input.subtitle ?? null,
    input.author ?? null,
    input.publisher ?? null,
    input.publication_year ?? null,
    input.edition ?? null,
    input.source_type ?? "book",
    input.grade,
    input.reference_score ?? null,
    input.status,
    input.seed ? 1 : 0,
    input.original_provider ?? "google-drive",
    input.original_file_id ?? null,
    input.original_folder ?? null
  ).run();

  await env.DB.prepare("DELETE FROM source_topics WHERE source_id = ?")
    .bind(input.source_id)
    .run();

  const topics = [...new Set(input.topics ?? [])];
  if (topics.length) {
    await env.DB.batch(
      topics.map((topic) =>
        env.DB.prepare(
          "INSERT OR IGNORE INTO source_topics (source_id, topic) VALUES (?, ?)"
        ).bind(input.source_id, topic)
      )
    );
  }

  return getSource(env, input.source_id);
}

export async function getSource(env: Env, sourceId: string) {
  return env.DB.prepare("SELECT * FROM sources WHERE source_id = ?")
    .bind(sourceId)
    .first();
}

export async function setSourceStatus(
  env: Env,
  sourceId: string,
  status: SourceStatus
) {
  const result = await env.DB.prepare(
    "UPDATE sources SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE source_id = ?"
  ).bind(status, sourceId).run();

  if (!result.meta.changes) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  return getSource(env, sourceId);
}


export async function listSources(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT
       source_id, title, author, publisher, publication_year,
       grade, reference_score, status, updated_at
     FROM sources
     ORDER BY
       CASE grade
         WHEN 'A' THEN 1
         WHEN 'B' THEN 2
         WHEN 'Supplemental' THEN 3
         ELSE 4
       END,
       reference_score DESC,
       source_id ASC`
  ).all();

  return rows.results ?? [];
}
