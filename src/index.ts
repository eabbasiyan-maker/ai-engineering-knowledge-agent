import type { Env } from "./env";
import { error, json, preflight, readJson, requireAdmin } from "./http";
import { getSource, listSources, setSourceStatus, upsertSource, type SourceInput, type SourceStatus } from "./catalog";
import { completeVersion, ingestChunkBatch, startVersion, type PreparedChunk } from "./ingestion";
import { searchKnowledge } from "./search";
import { answerQuestion, type AskRequest } from "./agent";
import { saveFeedback, type FeedbackInput } from "./feedback";
import { getAnalyticsSummary, recordAgentRequest } from "./analytics";
import { reviewCandidate } from "./curator";
import { getKnowledgeOverview } from "./knowledge-profile";
import { getPublicHome } from "./home";
import { getTelegramHealth, handleTelegramUpdate, verifyTelegramWebhook, type TelegramUpdate } from "./telegram";

const UI_ORIGIN = "https://ai-engineering-knowledge-agent-web.pages.dev";

const UI_PATHS = new Set([
  "/",
  "/index.html",
  "/app.js",
  "/home.css",
  "/answer.css",
  "/discovery.css",
  "/library.css",
  "/ingest",
  "/ingest.html",
  "/admin",
  "/admin.html",
  "/styles.css",
  "/admin.js",
  "/ingest-app.js",
  "/ingest-utils.js",
  "/ingest-pdf.js",
  "/ingest-epub.js",
  "/ingest-api.js",
  "/ingest-batch.js"
]);

async function proxyUiAsset(pathname: string): Promise<Response> {
  const sourcePath = pathname === "/"
    ? "/index.html"
    : pathname === "/ingest"
      ? "/ingest.html"
      : pathname === "/admin"
        ? "/admin.html"
        : pathname;
  const upstream = await fetch(UI_ORIGIN + sourcePath, {
    headers: { "User-Agent": "ai-engineering-knowledge-agent-worker" }
  });

  if (!upstream.ok) {
    return new Response("UI asset unavailable", { status: upstream.status });
  }

  let body = await upstream.text();

  if (sourcePath === "/ingest-pdf.js") {
    body = body
      .replace(
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.mjs",
        "/vendor/pdf.mjs"
      )
      .replace(
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.min.mjs",
        "/vendor/pdf.worker.min.mjs"
      );
  }

  if (sourcePath === "/ingest-epub.js") {
    body = body.replace(
      "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js",
      "/vendor/fflate.js"
    );
  }

  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.delete("content-security-policy");

  return new Response(body, { status: 200, headers });
}

async function proxyVendor(pathname: string): Promise<Response> {
  const target =
    pathname === "/vendor/pdf.mjs"
      ? "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.mjs"
      : pathname === "/vendor/pdf.worker.min.mjs"
        ? "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.min.mjs"
        : pathname === "/vendor/fflate.js"
          ? "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js"
          : null;

  if (!target) return new Response("Not found", { status: 404 });

  const upstream = await fetch(target, {
    headers: { "User-Agent": "ai-engineering-knowledge-agent-worker" }
  });

  if (!upstream.ok) {
    return new Response("Vendor asset unavailable", { status: upstream.status });
  }

  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, { status: 200, headers });
}

function sourcePath(pathname: string, suffix: string) {
  const m = pathname.match(new RegExp("^/admin/sources/([^/]+)/" + suffix + "$"));
  return m ? decodeURIComponent(m[1]) : null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return preflight();
      }

      if (request.method === "GET" && UI_PATHS.has(url.pathname)) {
        return proxyUiAsset(url.pathname);
      }

      if (request.method === "GET" && url.pathname.startsWith("/vendor/")) {
        return proxyVendor(url.pathname);
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "ai-engineering-knowledge-agent",
          phase: 9
        });
      }

      if (request.method === "GET" && url.pathname === "/health/telegram") {
        return json(await getTelegramHealth(env));
      }

      if (request.method === "GET" && url.pathname === "/api/v1/home") {
        return json(await getPublicHome(env));
      }

      if (request.method === "POST" && url.pathname === "/api/v1/ask") {
        const body = await readJson<AskRequest>(request);
        const question = String(body.question ?? "").trim();
        if (!question) return error("question is required");

        const allowedChannels = ["web", "telegram", "gpt", "api"];
        if (body.channel && !allowedChannels.includes(body.channel)) {
          return error("Unsupported channel");
        }

        const startedAt = Date.now();
        const result = await answerQuestion(env, { ...body, question });
        const automatedTest = request.headers.get("x-agent-traffic") === "automated_test";
        const analyticsChannel = automatedTest
          ? `test_${result.channel}`
          : result.channel;

        ctx.waitUntil(
          recordAgentRequest(env, {
            request_id: result.request_id,
            channel: analyticsChannel,
            question,
            evidence_status: result.evidence_status,
            confidence_score: result.confidence?.score ?? null,
            source_count: Array.isArray(result.sources) ? result.sources.length : 0,
            latency_ms: Date.now() - startedAt
          }).catch(() => undefined)
        );

        return json(result);
      }

      if (request.method === "POST" && url.pathname === "/api/v1/telegram/webhook") {
        if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
          return error("Telegram channel is not configured", 503, "NOT_CONFIGURED");
        }
        if (!verifyTelegramWebhook(request, env)) {
          return error("Unauthorized Telegram webhook", 401, "UNAUTHORIZED");
        }

        const update = await readJson<TelegramUpdate>(request);
        ctx.waitUntil(handleTelegramUpdate(env, update));
        return json({ ok: true });
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

      if (request.method === "POST" && url.pathname === "/admin/curator/review") {
        const body = await readJson<any>(request);
        const title = String(body.title ?? "").trim();
        if (!title) return error("title is required");
        return json(await reviewCandidate(env, { ...body, title }));
      }

      if (request.method === "GET" && url.pathname === "/admin/analytics/summary") {
        const days = Number(url.searchParams.get("days") ?? "30");
        return json(await getAnalyticsSummary(env, days));
      }

      if (request.method === "GET" && url.pathname === "/admin/knowledge/overview") {
        const limit = Number(url.searchParams.get("limit") ?? "10");
        return json(await getKnowledgeOverview(env, limit));
      }

      if (url.pathname === "/admin/sources" && request.method === "GET") {
        return json({ sources: await listSources(env) });
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