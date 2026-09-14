const API_BASE = "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

const form = document.querySelector("#ask-form");
const question = document.querySelector("#question");
const askButton = document.querySelector("#ask-button");
const clearButton = document.querySelector("#clear-button");
const loading = document.querySelector("#loading");
const errorBox = document.querySelector("#error-box");
const answerSection = document.querySelector("#answer-section");
const answerEl = document.querySelector("#answer");
const badges = document.querySelector("#badges");
const sourcesEl = document.querySelector("#sources");
const sourceCount = document.querySelector("#source-count");
const copyButton = document.querySelector("#copy-button");
const feedback = document.querySelector("#feedback");
const feedbackStatus = document.querySelector("#feedback-status");

let lastResponse = null;

function setLoading(value) {
  loading.classList.toggle("hidden", !value);
  askButton.disabled = value;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function badge(label) {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = label;
  return span;
}

function renderSources(sources = []) {
  sourcesEl.replaceChildren();
  sourceCount.textContent = `${sources.length} منبع`;

  for (const source of sources) {
    const card = document.createElement("article");
    card.className = "source";

    const title = document.createElement("p");
    title.className = "source-title";
    title.textContent = `[${source.id}] ${source.title || source.source_id}`;

    const meta = document.createElement("div");
    meta.className = "source-meta";

    const values = [
      `Grade: ${source.grade ?? "-"}`,
      source.reference_score != null ? `Reference: ${source.reference_score}` : null,
      source.version_id ? `Version: ${source.version_id}` : null,
      source.chapter ? `Chapter: ${source.chapter}` : null,
      source.section ? `Section: ${source.section}` : null,
      source.retrieval_score != null ? `Similarity: ${Number(source.retrieval_score).toFixed(3)}` : null
    ].filter(Boolean);

    for (const value of values) {
      const item = document.createElement("span");
      item.textContent = value;
      meta.append(item);
    }

    card.append(title, meta);
    sourcesEl.append(card);
  }
}

function renderResponse(data) {
  lastResponse = data;
  answerEl.textContent = data.answer || "";
  badges.replaceChildren();

  const evidenceMap = {
    supported: "پشتیبانی‌شده",
    partial: "شواهد ناکامل",
    no_evidence: "بدون شواهد کافی",
    conflict: "تعارض منابع"
  };

  badges.append(
    badge(`Evidence: ${evidenceMap[data.evidence_status] || data.evidence_status || "-"}`),
    badge(`Confidence: ${data.confidence?.level || "-"} ${data.confidence?.score ?? ""}`)
  );

  renderSources(data.sources || []);
  feedbackStatus.textContent = "";
  answerSection.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = question.value.trim();
  if (!q) return;

  clearError();
  answerSection.classList.add("hidden");
  setLoading(true);

  try {
    const response = await fetch(`${API_BASE}/api/v1/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, channel: "web", top_k: 8 })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || "خطا در دریافت پاسخ");
    }

    renderResponse(data);
  } catch (error) {
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  } finally {
    setLoading(false);
  }
});

clearButton.addEventListener("click", () => {
  question.value = "";
  answerSection.classList.add("hidden");
  clearError();
  question.focus();
});

copyButton.addEventListener("click", async () => {
  if (!lastResponse?.answer) return;
  await navigator.clipboard.writeText(lastResponse.answer);
  copyButton.textContent = "کپی شد";
  setTimeout(() => { copyButton.textContent = "کپی پاسخ"; }, 1200);
});

feedback.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-helpful]");
  if (!button || !lastResponse?.request_id) return;

  feedbackStatus.textContent = "در حال ثبت…";
  try {
    const response = await fetch(`${API_BASE}/api/v1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: lastResponse.request_id,
        helpful: button.dataset.helpful === "true",
        channel: "web"
      })
    });

    if (!response.ok) throw new Error("feedback failed");
    feedbackStatus.textContent = "ممنون؛ بازخورد ثبت شد.";
  } catch {
    feedbackStatus.textContent = "ثبت بازخورد ناموفق بود.";
  }
});
