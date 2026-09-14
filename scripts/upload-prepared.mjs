import fs from "node:fs/promises";

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const file = arg("file");
const baseUrl = (arg("api") || process.env.KNOWLEDGE_API_URL || "").replace(/\/$/, "");
const token = process.env.KNOWLEDGE_ADMIN_TOKEN;

if (!file || !baseUrl || !token) {
  console.error("Required: --file <prepared.json>, --api <worker-url> (or KNOWLEDGE_API_URL), KNOWLEDGE_ADMIN_TOKEN env var");
  process.exit(2);
}

const prepared = JSON.parse(await fs.readFile(file, "utf8"));
const sourceId = prepared.source_id;
const versionId = prepared.version_id;

async function call(path, method, body) {
  const r = await fetch(baseUrl + path, {
    method,
    headers: {
      "authorization": "Bearer " + token,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(r.status + " " + JSON.stringify(data));
  }
  return data;
}

await call("/admin/sources/" + encodeURIComponent(sourceId) + "/versions/start", "POST", {
  version_id: versionId,
  checksum: prepared.checksum
});

const chunks = prepared.chunks;
for (let i = 0; i < chunks.length; i += 32) {
  const batch = chunks.slice(i, i + 32);
  await call("/admin/sources/" + encodeURIComponent(sourceId) + "/chunks", "POST", {
    version_id: versionId,
    chunks: batch
  });
  console.log("uploaded", Math.min(i + batch.length, chunks.length), "/", chunks.length);
}

const completed = await call(
  "/admin/sources/" + encodeURIComponent(sourceId) + "/versions/complete",
  "POST",
  { version_id: versionId }
);

console.log(JSON.stringify({ ok: true, completed }, null, 2));
