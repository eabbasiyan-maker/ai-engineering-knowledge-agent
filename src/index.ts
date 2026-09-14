import type { Env } from "./env";
import { error, json, preflight, readJson, requireAdmin } from "./http";
import { getSource, setSourceStatus, upsertSource, type SourceInput, type SourceStatus } from "./catalog";
import { completeVersion, ingestChunkBatch, startVersion, type PreparedChunk } from "./ingestion";
import { searchKnowledge } from "./search";
import { answerQuestion, type AskRequest } from "./agent";
import { saveFeedback, type FeedbackInput } from "./feedback";

function sourcePath(pathname: string, suffix: string) {
  const m = pathname.match(new RegExp("^/admin/sources/([^/]+)/" + suffix + "$"));
  return m ? decodeURIComponent(m[1]) : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return preflight();
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "ai-engineering-knowledge-agent",
          phase: 3
        });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/ask") {
        const body = await readJson<AskRequest>(request);
        const question = String(body.question ?? "").trim();
        if (!question) return error("question is required");

        const allowedChannels = ["web", "telegram", "gpt", "api"];
        if (body.channel && !allowedChannels.includes(body.channel)) {
          return error("Unsupported channel");
        }

        return json(await answerQuestion(env, { ...body, question }));
      }

      if (request.method === "POST" && url.pathname === "/api/v1/feedback") {
        const body = await readJson<FeedbackInput>(request);
        const requestId = String(body.request_id ?? "").trim();
        if (!requestId) return error("request_id is required");
        if (typeof body.helpful !== "boolean") return error("helpful must be boolean");

        return json(await saveFeedback(env, {
          request_id: requestId,
          helpful: body.helpful,
          comment: body.comment ?? null,
          channel: body.channel ?? "web"
        }), 201);
      }

      if (url.pathname.startsWith("/admin/")) {
        const denied = requireAdmin(request, env);
        if (denied) return denied;
      }

      if (request.method === "POST" && url.pathname === "/admin/sources") {
        const input = await readJson<SourceInput>(request);
        if (!input.source_id || !input.title || !input.grade || !input.status) {
          return error("source_id, title, grade and status are required");
        }
        return json(await upsertSource(env, input), 201);
      }

      const getSourceId = sourcePath(url.pathname, "");
      if (request.method === "GET" && getSourceId) {
        const source = await getSource(env, getSourceId);
        return source ? json(source) : error("Source not found", 404, "NOT_FOUND");
      }

      const statusSourceId = sourcePath(url.pathname, "status");
      if (request.method === "POST" && statusSourceId) {
        const body = await readJson<{ status: SourceStatus }>(request);
        const allowed: SourceStatus[] = [
          "incoming", "approved", "active", "active_secondary",
          "disabled", "archived", "rejected"
        ];
        if (!allowed.includes(body.status)) {
          return error("Unsupported source status");
        }
        return json(await setSourceStatus(env, statusSourceId, body.status));
      }

      const startSourceId = sourcePath(url.pathname, "versions/start");
      if (request.method === "POST" && startSourceId) {
        const body = await readJson<{
          version_id: string;
          edition?: string | null;
          checksum?: string | null;
        }>(request);
        if (!body.version_id) return error("version_id is required");
        return json(await startVersion(
          env,
          startSourceId,
          body.version_id,
          body.edition,
          body.checksum
        ), 201);
      }

      const chunkSourceId = sourcePath(url.pathname, "chunks");
      if (request.method === "POST" && chunkSourceId) {
        const body = await readJson<{
          version_id: string;
          chunks: PreparedChunk[];
        }>(request);
        if (!body.version_id || !Array.isArray(body.chunks)) {
          return error("version_id and chunks are required");
        }
        return json(await ingestChunkBatch(
          env,
          chunkSourceId,
          body.version_id,
          body.chunks
        ), 201);
      }

      const completeSourceId = sourcePath(url.pathname, "versions/complete");
      if (request.method === "POST" && completeSourceId) {
        const body = await readJson<{ version_id: string }>(request);
        if (!body.version_id) return error("version_id is required");
        return json(await completeVersion(env, completeSourceId, body.version_id));
      }

      if (request.method === "GET" && url.pathname === "/admin/search") {
        const q = url.searchParams.get("q")?.trim();
        const topK = Number(url.searchParams.get("top_k") ?? "8");
        if (!q) return error("q is required");
        return json({ query: q, matches: await searchKnowledge(env, q, topK) });
      }

      return error("Route not found", 404, "NOT_FOUND");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return error(message, 500, "INTERNAL_ERROR");
    }
  }
} satisfies ExportedHandler<Env>;
