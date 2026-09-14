const API_BASE = "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

export function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token
  };
}

export async function api(path, token, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...authHeaders(token),
      ...(options.headers || {})
    }
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || "API error " + response.status);
  }
  return body;
}

export async function listSources(token) {
  return api("/admin/sources", token);
}

export async function startVersion(token, sourceId, versionId, checksum) {
  return api("/admin/sources/" + encodeURIComponent(sourceId) + "/versions/start", token, {
    method: "POST",
    body: JSON.stringify({ version_id: versionId, checksum })
  });
}

export async function uploadChunks(token, sourceId, versionId, chunks) {
  return api("/admin/sources/" + encodeURIComponent(sourceId) + "/chunks", token, {
    method: "POST",
    body: JSON.stringify({ version_id: versionId, chunks })
  });
}

export async function completeVersion(token, sourceId, versionId) {
  return api("/admin/sources/" + encodeURIComponent(sourceId) + "/versions/complete", token, {
    method: "POST",
    body: JSON.stringify({ version_id: versionId })
  });
}
