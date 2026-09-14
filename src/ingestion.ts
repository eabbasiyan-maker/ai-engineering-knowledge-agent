import type { Env } from "./env";
import { getSource } from "./catalog";

export interface PreparedChunk {
  chunk_id: string;
  index: number;
  chapter?: string | null;
  section?: string | null;
  heading_path?: string[];
  content_hash: string;
  token_count?: number | null;
  text: string;
}

export async function startVersion(
  env: Env,
  sourceId: string,
  versionId: string,
  edition?: string | null,
  checksum?: string | null
) {
  const source = await getSource(env, sourceId);
  if (!source) throw new Error(`Unknown source: ${sourceId}`);

  await env.DB.prepare(
    `INSERT INTO source_versions
      (version_id, source_id, edition, checksum, status, created_at)
     VALUES (?, ?, ?, ?, 'processing', CURRENT_TIMESTAMP)
     ON CONFLICT(version_id) DO UPDATE SET
       edition=excluded.edition,
       checksum=excluded.checksum,
       status='processing'`
  ).bind(versionId, sourceId, edition ?? null, checksum ?? null).run();

  return { source_id: sourceId, version_id: versionId, status: "processing" };
}

export async function ingestChunkBatch(
  env: Env,
  sourceId: string,
  versionId: string,
  chunks: PreparedChunk[]
) {
  if (!chunks.length) return { inserted: 0 };
  if (chunks.length > 32) throw new Error("Maximum 32 chunks per batch");

  const source = await getSource(env, sourceId) as Record<string, unknown> | null;
  if (!source) throw new Error(`Unknown source: ${sourceId}`);

  const texts = chunks.map((c) => c.text);
  const embeddingResult = await env.AI.run(
    (env.EMBEDDING_MODEL || "@cf/baai/bge-m3") as any,
    { text: texts } as any
  ) as any;

  const vectors = embeddingResult?.data as number[][] | undefined;
  if (!vectors || vectors.length !== chunks.length) {
    throw new Error("Embedding result count does not match chunk count");
  }

  const vectorRecords = [];
  const dbStatements = [];

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const r2Key = `processed/${sourceId}/${versionId}/chunks/${c.chunk_id}.txt`;
    const storageKey = env.KNOWLEDGE_R2 ? r2Key : `d1://knowledge_chunks/${c.chunk_id}`;

    // D1 is the MVP operational text store. R2, when enabled later,
    // receives the same derivative text as an optimization/archive layer.
    if (env.KNOWLEDGE_R2) {
      await env.KNOWLEDGE_R2.put(r2Key, c.text, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
        customMetadata: {
          source_id: sourceId,
          version_id: versionId,
          chunk_id: c.chunk_id,
          content_hash: c.content_hash
        }
      });
    }

    vectorRecords.push({
      id: c.chunk_id,
      values: vectors[i],
      metadata: {
        source_id: sourceId,
        version_id: versionId,
        chunk_id: c.chunk_id,
        grade: String(source.grade ?? ""),
        chapter: c.chapter ?? "",
        section: c.section ?? ""
      }
    });

    dbStatements.push(
      env.DB.prepare(
        `INSERT INTO knowledge_chunks (
          chunk_id, source_id, version_id, chapter, section, heading_path,
          chunk_index, content_hash, token_count, status, content_text,
          r2_text_key, vector_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(chunk_id) DO UPDATE SET
          version_id=excluded.version_id,
          chapter=excluded.chapter,
          section=excluded.section,
          heading_path=excluded.heading_path,
          chunk_index=excluded.chunk_index,
          content_hash=excluded.content_hash,
          token_count=excluded.token_count,
          status='active',
          content_text=excluded.content_text,
          r2_text_key=excluded.r2_text_key,
          vector_id=excluded.vector_id,
          updated_at=CURRENT_TIMESTAMP`
      ).bind(
        c.chunk_id,
        sourceId,
        versionId,
        c.chapter ?? null,
        c.section ?? null,
        JSON.stringify(c.heading_path ?? []),
        c.index,
        c.content_hash,
        c.token_count ?? null,
        c.text,
        storageKey,
        c.chunk_id
      )
    );
  }

  await env.VECTORIZE.upsert(vectorRecords);
  await env.DB.batch(dbStatements);

  return {
    inserted: chunks.length,
    text_store: env.KNOWLEDGE_R2 ? "d1+r2" : "d1"
  };
}

export async function completeVersion(
  env: Env,
  sourceId: string,
  versionId: string
) {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM knowledge_chunks
     WHERE source_id = ? AND version_id = ? AND status = 'active'`
  ).bind(sourceId, versionId).first<{ count: number }>();

  if (!count?.count) throw new Error("Cannot activate an empty source version");

  const manifest = {
    schemaVersion: "1.1",
    sourceId,
    versionId,
    chunkCount: count.count,
    textStore: env.KNOWLEDGE_R2 ? "d1+r2" : "d1",
    completedAt: new Date().toISOString()
  };

  let manifestKey: string | null = null;
  if (env.KNOWLEDGE_R2) {
    manifestKey = `processed/${sourceId}/${versionId}/manifest.json`;
    await env.KNOWLEDGE_R2.put(
      manifestKey,
      JSON.stringify(manifest, null, 2),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } }
    );
  }

  const staleVectors = await env.DB.prepare(
    `SELECT vector_id
     FROM knowledge_chunks
     WHERE source_id = ?
       AND version_id <> ?
       AND vector_id IS NOT NULL`
  ).bind(sourceId, versionId).all<{ vector_id: string }>();

  const staleVectorIds = (staleVectors.results ?? [])
    .map((row) => row.vector_id)
    .filter((id): id is string => Boolean(id));

  for (let i = 0; i < staleVectorIds.length; i += 500) {
    await env.VECTORIZE.deleteByIds(staleVectorIds.slice(i, i + 500));
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE source_versions
       SET status='archived', archived_at=CURRENT_TIMESTAMP
       WHERE source_id = ? AND version_id <> ? AND status IN ('active','processing')`
    ).bind(sourceId, versionId),
    env.DB.prepare(
      `UPDATE knowledge_chunks
       SET status='archived', updated_at=CURRENT_TIMESTAMP
       WHERE source_id = ? AND version_id <> ? AND status='active'`
    ).bind(sourceId, versionId),
    env.DB.prepare(
      `UPDATE source_versions
       SET status='active', activated_at=CURRENT_TIMESTAMP,
           r2_manifest_key=?, manifest_json=?
       WHERE source_id = ? AND version_id = ?`
    ).bind(
      manifestKey,
      JSON.stringify(manifest),
      sourceId,
      versionId
    ),
    env.DB.prepare(
      `UPDATE sources
       SET status = CASE
         WHEN grade='A' THEN 'active'
         WHEN grade='B' THEN 'active_secondary'
         ELSE status
       END,
       updated_at=CURRENT_TIMESTAMP
       WHERE source_id = ?`
    ).bind(sourceId)
  ]);

  return {
    ...manifest,
    staleVectorsDeleteRequested: staleVectorIds.length
  };
}
