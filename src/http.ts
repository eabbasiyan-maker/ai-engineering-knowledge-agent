import type { Env } from "./env";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Setup-Secret",
  "Access-Control-Max-Age": "86400"
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function error(message: string, status = 400, code = "BAD_REQUEST"): Response {
  return json({ error: { code, message } }, status);
}

export function requireAdmin(request: Request, env: Env): Response | null {
  const auth = request.headers.get("authorization") ?? "";
  const expected = "Bearer " + env.ADMIN_TOKEN;
  if (!env.ADMIN_TOKEN || auth !== expected) {
    return error("Unauthorized", 401, "UNAUTHORIZED");
  }
  return null;
}

export async function readJson<T>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new Error("Content-Type must be application/json");
  }
  return request.json<T>();
}
