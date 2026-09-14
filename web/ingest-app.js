import { chunkText, sha256Hex } from "./ingest-utils.js";
import { extractPdf } from "./ingest-pdf.js";
import { extractEpub } from "./ingest-epub.js";
import { listSources, startVersion, uploadChunks, completeVersion } from "./ingest-api.js";

const tokenEl = document.getElementById("token");
const sourceEl = document.getElementById("source");
const fileEl = document.getElementById("book-file");
const versionEl = document.getElementById("version");
const statusCard = document.getElementById("status-card");
const statusText = document.getElementById("status-text");
const summaryEl = document.getElementById("summary");
const summaryBody = document.getElementById("summary-body");
const errorBox = document.getElementById("error-box");
const uploadBtn = document.getElementById("upload");

let prepared = null;

const showStatus = (message) => {
  statusText.textContent = message;
  statusCard.classList.remove("hidden");
};
const hideStatus = () => statusCard.classList.add("hidden");
const showError = (message) => {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
};
const clearError = () => errorBox.classList.add("hidden");

document.getElementById("load-sources").addEventListener("click", async () => {
  clearError();
  try {
    showStatus("در حال خواندن کاتالوگ منابع…");
    const token = tokenEl.value.trim();
    if (!token) throw new Error("Admin Token را وارد کن.");

    const data = await listSources(token);
    sourceEl.replaceChildren();

    for (const source of data.sources || []) {
      const option = document.createElement("option");
      option.value = source.source_id;
      option.textContent =
        source.source_id + " — " + source.title +
        " — Grade " + source.grade +
        " — " + source.status;
      sourceEl.append(option);
    }

    if (sourceEl.value) versionEl.value = sourceEl.value + "-v1";
    hideStatus();
  } catch (error) {
    hideStatus();
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  }
});

sourceEl.addEventListener("change", () => {
  if (sourceEl.value) versionEl.value = sourceEl.value + "-v1";
});

document.getElementById("prepare").addEventListener("click", async () => {
  clearError();
  prepared = null;
  uploadBtn.disabled = true;
  summaryEl.classList.add("hidden");

  try {
    const sourceId = sourceEl.value;
    const versionId = versionEl.value.trim();
    const file = fileEl.files?.[0];

    if (!sourceId) throw new Error("یک منبع انتخاب کن.");
    if (!versionId) throw new Error("Version ID را وارد کن.");
    if (!file) throw new Error("فایل کتاب را انتخاب کن.");

    showStatus("در حال خواندن فایل…");

    const lower = file.name.toLowerCase();
    const extracted = lower.endsWith(".pdf")
      ? await extractPdf(file, showStatus)
      : lower.endsWith(".epub")
        ? await extractEpub(file, showStatus)
        : null;

    if (!extracted) throw new Error("فقط PDF و EPUB پشتیبانی می‌شود.");

    showStatus("در حال ساخت Chunkها…");
    const checksum = await sha256Hex(extracted.bytes);
    const rawChunks = chunkText(extracted.text);
    const chunks = [];
    const chunkPrefix = versionId.startsWith(sourceId + "-")
      ? versionId
      : sourceId + "-" + versionId;

    for (let i = 0; i < rawChunks.length; i++) {
      const item = rawChunks[i];
      if (i % 20 === 0) {
        showStatus("ساخت Chunkها — " + (i + 1) + " از " + rawChunks.length);
      }

      chunks.push({
        chunk_id: chunkPrefix + "-C" + String(i + 1).padStart(5, "0"),
        index: i,
        chapter: item.chapter,
        section: item.section,
        heading_path: item.heading_path,
        content_hash: await sha256Hex(item.text),
        token_count: Math.ceil(item.text.length / 4),
        text: item.text
      });
    }

    prepared = { sourceId, versionId, checksum, chunks };

    summaryBody.textContent =
      "Source: " + sourceId + "\n" +
      "Version: " + versionId + "\n" +
      "File: " + file.name + "\n" +
      "Size: " + (file.size / 1024 / 1024).toFixed(1) + " MB\n" +
      "Extracted chars: " + extracted.text.length.toLocaleString() + "\n" +
      "Chunks: " + chunks.length;

    summaryEl.classList.remove("hidden");
    uploadBtn.disabled = false;
    hideStatus();
  } catch (error) {
    hideStatus();
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  }
});


uploadBtn.addEventListener("click", async () => {
  clearError();

  try {
    if (!prepared) throw new Error("اول فایل را آماده‌سازی کن.");

    const token = tokenEl.value.trim();
    if (!token) throw new Error("Admin Token را وارد کن.");

    showStatus("شروع Version…");
    await startVersion(
      token,
      prepared.sourceId,
      prepared.versionId,
      prepared.checksum
    );

    const batchSize = 16;

    for (let i = 0; i < prepared.chunks.length; i += batchSize) {
      const batch = prepared.chunks.slice(i, i + batchSize);

      showStatus(
        "ارسال Chunkها — " +
        Math.min(i + batch.length, prepared.chunks.length) +
        " از " + prepared.chunks.length
      );

      await uploadChunks(
        token,
        prepared.sourceId,
        prepared.versionId,
        batch
      );
    }

    showStatus("فعال‌سازی نسخه جدید…");
    const result = await completeVersion(
      token,
      prepared.sourceId,
      prepared.versionId
    );

    summaryBody.textContent +=
      "\n\n✅ Ingestion complete" +
      "\nActive chunks: " + result.chunkCount +
      "\nText store: " + result.textStore;

    uploadBtn.disabled = true;
    hideStatus();
  } catch (error) {
    hideStatus();
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  }
});
