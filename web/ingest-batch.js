import { unzipSync, strFromU8 } from "/vendor/fflate.js";
import { startVersion, uploadChunks, completeVersion } from "./ingest-api.js";

const tokenEl = document.getElementById("token");
const fileEl = document.getElementById("batch-file");
const button = document.getElementById("batch-upload");
const statusEl = document.getElementById("batch-status");
const errorEl = document.getElementById("batch-error");

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function clearMessages() {
  statusEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  statusEl.textContent = "";
  errorEl.textContent = "";
}

button?.addEventListener("click", async () => {
  clearMessages();

  try {
    const token = tokenEl?.value.trim();
    const file = fileEl?.files?.[0];

    if (!token) throw new Error("Admin Token را وارد کن.");
    if (!file) throw new Error("فایل ZIP آماده‌شده را انتخاب کن.");

    button.disabled = true;
    showStatus("در حال بازکردن بسته…");

    const zipBytes = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(zipBytes);

    const manifests = Object.entries(files)
      .filter(([name]) => /^BOOK-\d+\.json$/i.test(name.split("/").pop() || ""))
      .map(([name, bytes]) => {
        const parsed = JSON.parse(strFromU8(bytes));
        return { name, parsed };
      })
      .sort((a, b) =>
        String(a.parsed.source_id).localeCompare(String(b.parsed.source_id))
      );

    if (!manifests.length) {
      throw new Error("هیچ manifest معتبری داخل ZIP پیدا نشد.");
    }

    const completed = [];

    for (let bookIndex = 0; bookIndex < manifests.length; bookIndex++) {
      const manifest = manifests[bookIndex].parsed;
      const sourceId = String(manifest.source_id || "");
      const versionId = String(manifest.version_id || "");
      const checksum = String(manifest.checksum || "");
      const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];

      if (!sourceId || !versionId || !checksum || !chunks.length) {
        throw new Error("Manifest ناقص است: " + manifests[bookIndex].name);
      }

      showStatus(
        "کتاب " + (bookIndex + 1) + " از " + manifests.length +
        " — " + sourceId + " — شروع نسخه"
      );

      await startVersion(token, sourceId, versionId, checksum);

      const batchSize = 16;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);

        showStatus(
          "کتاب " + (bookIndex + 1) + " از " + manifests.length +
          " — " + sourceId +
          " — Chunk " + Math.min(i + batch.length, chunks.length) +
          " از " + chunks.length
        );

        await uploadChunks(token, sourceId, versionId, batch);
      }

      showStatus(
        "کتاب " + (bookIndex + 1) + " از " + manifests.length +
        " — " + sourceId + " — فعال‌سازی"
      );

      const result = await completeVersion(token, sourceId, versionId);

      completed.push({
        source_id: sourceId,
        version_id: versionId,
        chunk_count: result.chunkCount
      });
    }

    showStatus(
      "✅ ورود گروهی کامل شد\n\n" +
      completed.map((item) =>
        item.source_id + " — " + item.chunk_count + " chunks"
      ).join("\n")
    );
  } catch (error) {
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  } finally {
    button.disabled = false;
  }
});
