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
const evidenceSummaryEl = document.querySelector("#evidence-summary");
const sourcesEl = document.querySelector("#sources");
const sourceCount = document.querySelector("#source-count");
const copyButton = document.querySelector("#copy-button");
const copyStatus = document.querySelector("#copy-status");
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
    supported: { label: "مستند", tone: "success", icon: "✓" },
    partial: { label: "نیمه‌مستند", tone: "warning", icon: "◐" },
    no_evidence: { label: "مدرک ناکافی", tone: "warning", icon: "!" },
    conflict: { label: "اختلاف منابع", tone: "danger", icon: "≠" }
  };
  return map[status] || { label: "نیاز به بررسی", tone: "neutral", icon: "?" };
}

function evidenceSummary(status) {
  const map = {
    supported: "برای نکات اصلی این پاسخ، شواهد کافی در منابع فعال کتابخانه پیدا شده است.",
    partial: "بخشی از پاسخ با شواهد مستقیم پشتیبانی می‌شود؛ بعضی بخش‌ها نیاز به بررسی بیشتری دارند.",
    no_evidence: "برای ارائه یک پاسخ قطعی، شواهد کافی در منابع فعال کتابخانه پیدا نشده است.",
    conflict: "منابع فعال در این موضوع با هم اختلاف دارند؛ پاسخ باید با توجه به این اختلاف خوانده شود."
  };
  return map[status] || "وضعیت شواهد این پاسخ نیاز به بررسی دارد.";
}

function confidenceLabel(confidence) {
  const level = String(confidence?.level || "").toLowerCase();
  if (level === "high") return "قدرت شواهد: زیاد";
  if (level === "medium") return "قدرت شواهد: متوسط";
  if (level === "low") return "قدرت شواهد: کم";
  return "قدرت شواهد: ثبت نشده";
}

function appendInlineText(parent, text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      parent.append(strong);
      continue;
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      parent.append(code);
      continue;
    }

    parent.append(document.createTextNode(part));
  }
}

function renderAnswerText(text) {
  if (!answerEl) return;
  answerEl.replaceChildren();

  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (!normalized) return;

  const lines = normalized.split("\n");
  let currentList = null;
  let currentListType = null;

  function flushList() {
    if (currentList) answerEl.append(currentList);
    currentList = null;
    currentListType = null;
  }

  function ensureList(type) {
    if (currentList && currentListType === type) return currentList;
    flushList();
    currentListType = type;
    currentList = document.createElement(type);
    return currentList;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      const tag = heading[1].length <= 2 ? "h3" : "h4";
      const el = document.createElement(tag);
      appendInlineText(el, heading[2]);
      answerEl.append(el);
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      const list = ensureList("ul");
      const item = document.createElement("li");
      appendInlineText(item, bullet[1]);
      list.append(item);
      continue;
    }

    const numbered = line.match(/^(?:\d+|[۰-۹]+)[.)]\s+(.+)$/);
    if (numbered) {
      const list = ensureList("ol");
      const item = document.createElement("li");
      appendInlineText(item, numbered[1]);
      list.append(item);
      continue;
    }

    flushList();
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, line);
    answerEl.append(paragraph);
  }

  flushList();
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

  sources.forEach((source, index) => {
    const card = document.createElement("article");
    card.className = "source";

    const indexLabel = document.createElement("span");
    indexLabel.className = "source-index";
    indexLabel.textContent = `منبع ${(index + 1).toLocaleString("fa-IR")}`;

    const title = document.createElement("p");
    title.className = "source-title";
    title.textContent = source.title || source.source_id || "منبع";

    const meta = document.createElement("div");
    meta.className = "source-meta";

    const values = [
      source.chapter ? `فصل: ${source.chapter}` : null,
      source.section ? `بخش: ${source.section}` : null
    ].filter(Boolean);

    for (const value of values) {
      const item = document.createElement("span");
      item.textContent = value;
      meta.append(item);
    }

    card.append(indexLabel, title);
    if (values.length > 0) card.append(meta);
    sourcesEl.append(card);
  });
}

function resetFeedback() {
  if (feedbackStatus) feedbackStatus.textContent = "";
  if (!feedback) return;
  for (const button of feedback.querySelectorAll("button[data-helpful]")) {
    button.disabled = false;
    button.classList.remove("is-selected");
    button.setAttribute("aria-pressed", "false");
  }
}

function renderResponse(data, askedQuestion) {
  lastResponse = data;
  renderAnswerText(data.answer || "");
  if (answeredQuestion) answeredQuestion.textContent = askedQuestion || "";

  if (badges) {
    badges.replaceChildren();
    const evidence = evidenceLabel(data.evidence_status);
    badges.append(
      badge(`${evidence.icon} ${evidence.label}`, evidence.tone),
      badge(confidenceLabel(data.confidence), "info")
    );
  }

  if (evidenceSummaryEl) {
    evidenceSummaryEl.textContent = evidenceSummary(data.evidence_status);
    evidenceSummaryEl.dataset.status = data.evidence_status || "unknown";
  }

  renderSources(data.sources || []);
  resetFeedback();
  if (copyStatus) copyStatus.textContent = "";
  if (copyButton) copyButton.textContent = "کپی پاسخ";

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
  try {
    await navigator.clipboard.writeText(lastResponse.answer);
    copyButton.textContent = "کپی شد";
    if (copyStatus) copyStatus.textContent = "پاسخ در کلیپ‌بورد ذخیره شد.";
  } catch {
    if (copyStatus) copyStatus.textContent = "کپی خودکار انجام نشد؛ متن را دستی انتخاب کن.";
  }

  setTimeout(() => {
    if (copyButton) copyButton.textContent = "کپی پاسخ";
    if (copyStatus) copyStatus.textContent = "";
  }, 1800);
});

feedback?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-helpful]");
  if (!button || !lastResponse?.request_id) return;

  const feedbackButtons = [...feedback.querySelectorAll("button[data-helpful]")];
  for (const item of feedbackButtons) item.disabled = true;
  if (feedbackStatus) feedbackStatus.textContent = "در حال ثبت بازخورد…";

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
    button.classList.add("is-selected");
    button.setAttribute("aria-pressed", "true");
    if (feedbackStatus) feedbackStatus.textContent = "ممنون؛ بازخوردت ثبت شد.";
  } catch {
    for (const item of feedbackButtons) item.disabled = false;
    if (feedbackStatus) feedbackStatus.textContent = "ثبت بازخورد ناموفق بود؛ دوباره تلاش کن.";
  }
});

loadHomeData();
