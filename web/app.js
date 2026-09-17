const API_BASE = "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

const form = document.querySelector("#ask-form");
const question = document.querySelector("#question");
const askButton = document.querySelector("#ask-button");
const loading = document.querySelector("#loading");
const errorBox = document.querySelector("#error-box");
const answerSection = document.querySelector("#answer-section");
const answerEl = document.querySelector("#answer");
const answeredQuestion = document.querySelector("#answered-question");
const badges = document.querySelector("#badges");
const sourcesEl = document.querySelector("#sources");
const sourceCount = document.querySelector("#source-count");
const copyButton = document.querySelector("#copy-button");
const feedback = document.querySelector("#feedback");
const feedbackStatus = document.querySelector("#feedback-status");
const updatedEl = document.querySelector("#stat-updated");
const booksEl = document.querySelector("#stat-books");
const chunksEl = document.querySelector("#stat-chunks");
const frequentQuestionsEl = document.querySelector("#frequent-questions");
const recentQuestionsEl = document.querySelector("#recent-questions");

let lastResponse = null;

function setLoading(value) {
  loading?.classList.toggle("hidden", !value);
  if (askButton) askButton.disabled = value;
}

function showError(message) {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  if (!errorBox) return;
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function badge(label, tone = "neutral") {
  const span = document.createElement("span");
  span.className = `badge badge-${tone}`;
  span.textContent = label;
  return span;
}

function evidenceLabel(status) {
  const map = {
    supported: { label: "مستند", tone: "success" },
    partial: { label: "نیمه‌مستند", tone: "warning" },
    no_evidence: { label: "مدرک ناکافی", tone: "warning" },
    conflict: { label: "اختلاف منابع", tone: "danger" }
  };
  return map[status] || { label: "نیاز به بررسی", tone: "neutral" };
}

function confidenceLabel(confidence) {
  const level = String(confidence?.level || "").toLowerCase();
  if (level === "high") return "قدرت شواهد: زیاد";
  if (level === "medium") return "قدرت شواهد: متوسط";
  if (level === "low") return "قدرت شواهد: کم";
  return "قدرت شواهد: ثبت نشده";
}

function renderSources(sources = []) {
  if (!sourcesEl || !sourceCount) return;
  sourcesEl.replaceChildren();
  sourceCount.textContent = `${sources.length.toLocaleString("fa-IR")} منبع`;

  if (sources.length === 0) {
    const empty = document.createElement("article");
    empty.className = "source source-empty";
    empty.textContent = "برای این پاسخ منبع کافی پیدا نشد.";
    sourcesEl.append(empty);
    return;
  }

  for (const source of sources) {
    const card = document.createElement("article");
    card.className = "source";

    const title = document.createElement("p");
    title.className = "source-title";
    title.textContent = source.title || source.source_id || "منبع";

    const meta = document.createElement("div");
    meta.className = "source-meta";

    const values = [
      source.chapter ? `فصل: ${source.chapter}` : null,
      source.section ? `بخش: ${source.section}` : null,
      source.version_id ? `نسخه: ${source.version_id}` : null,
      source.grade ? `Grade: ${source.grade}` : null
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

function renderResponse(data, askedQuestion) {
  lastResponse = data;
  if (answerEl) answerEl.textContent = data.answer || "";
  if (answeredQuestion) answeredQuestion.textContent = askedQuestion || "";
  if (badges) {
    badges.replaceChildren();
    const evidence = evidenceLabel(data.evidence_status);
    badges.append(
      badge(`✓ ${evidence.label}`, evidence.tone),
      badge(confidenceLabel(data.confidence), "info"),
      badge(`${(data.sources || []).length.toLocaleString("fa-IR")} منبع`, "neutral")
    );
  }

  renderSources(data.sources || []);
  if (feedbackStatus) feedbackStatus.textContent = "";
  answerSection?.classList.remove("hidden");
  answerSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function ask(q) {
  const clean = String(q || "").trim();
  if (!clean) return;

  if (question) question.value = clean;
  clearError();
  answerSection?.classList.add("hidden");
  setLoading(true);

  try {
    const response = await fetch(`${API_BASE}/api/v1/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: clean, channel: "web", top_k: 8 })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || "خطا در دریافت پاسخ");
    }

    renderResponse(data, clean);
  } catch (error) {
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  } finally {
    setLoading(false);
  }
}

function renderQuestionList(root, items) {
  if (!root || !Array.isArray(items) || items.length === 0) return;
  root.replaceChildren();
  for (const item of items.slice(0, 4)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.question = item;
    button.textContent = item;
    root.append(button);
  }
}

function formatPersianDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return "امروز";
  }
}

async function loadHomeData() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/home`);
    if (!response.ok) return;
    const data = await response.json();

    const library = data.library || {};
    if (booksEl) booksEl.textContent = `${Number(library.active_books || 0).toLocaleString("fa-IR")} کتاب فعال`;
    if (chunksEl) chunksEl.textContent = `${Number(library.active_chunks || 0).toLocaleString("fa-IR")} بخش دانش`;
    if (updatedEl) updatedEl.textContent = formatPersianDate(library.latest_update);

    renderQuestionList(frequentQuestionsEl, data.frequent_questions);
    renderQuestionList(recentQuestionsEl, data.recent_questions);
  } catch {
    // Keep curated fallback content already present in HTML.
  }
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(question?.value);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-question]");
  if (!button) return;
  const q = button.dataset.question || button.textContent || "";
  if (question) {
    question.value = q.trim();
    question.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

copyButton?.addEventListener("click", async () => {
  if (!lastResponse?.answer) return;
  await navigator.clipboard.writeText(lastResponse.answer);
  copyButton.textContent = "کپی شد";
  setTimeout(() => { copyButton.textContent = "کپی پاسخ"; }, 1200);
});

feedback?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-helpful]");
  if (!button || !lastResponse?.request_id) return;

  if (feedbackStatus) feedbackStatus.textContent = "در حال ثبت…";
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
    if (feedbackStatus) feedbackStatus.textContent = "ممنون؛ بازخورد ثبت شد.";
  } catch {
    if (feedbackStatus) feedbackStatus.textContent = "ثبت بازخورد ناموفق بود.";
  }
});

loadHomeData();
