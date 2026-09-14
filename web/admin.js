const API_BASE = "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

const form = document.getElementById("analytics-form");
const tokenEl = document.getElementById("token");
const daysEl = document.getElementById("days");
const errorEl = document.getElementById("analytics-error");
const resultEl = document.getElementById("analytics-result");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideError() {
  errorEl.classList.add("hidden");
  errorEl.textContent = "";
}

function makeCard(title, value, detail) {
  const box = document.createElement("article");
  box.className = "source";
  const heading = document.createElement("p");
  heading.className = "source-title";
  heading.textContent = title;
  const number = document.createElement("div");
  number.style.fontSize = "28px";
  number.style.fontWeight = "800";
  number.textContent = String(value ?? "-");
  box.append(heading, number);
  if (detail) {
    const info = document.createElement("p");
    info.className = "muted";
    info.textContent = detail;
    box.append(info);
  }
  return box;
}

function makeRow(title, meta) {
  const box = document.createElement("article");
  box.className = "source";
  const heading = document.createElement("p");
  heading.className = "source-title";
  heading.dir = "auto";
  heading.textContent = title || "—";
  const info = document.createElement("p");
  info.className = "muted";
  info.textContent = meta || "";
  box.append(heading, info);
  return box;
}

function fill(selector, items, renderer) {
  const root = document.querySelector(selector);
  root.replaceChildren();
  if (!items || items.length === 0) {
    root.append(makeRow("داده‌ای وجود ندارد", ""));
    return;
  }
  for (const item of items) root.append(renderer(item));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  resultEl.classList.add("hidden");

  const token = tokenEl.value.trim();
  const days = Number(daysEl.value || 30);
  if (!token) return;

  try {
    const response = await fetch(API_BASE + "/admin/analytics/summary?days=" + days, {
      headers: { "Authorization": "Bearer " + token }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "دریافت گزارش ناموفق بود.");

    const totals = data.totals || {};
    const feedback = data.feedback || {};
    const cards = document.getElementById("summary-cards");
    cards.replaceChildren(
      makeCard("کل درخواست‌ها", totals.request_count ?? 0),
      makeCard("میانگین زمان پاسخ", Math.round(Number(totals.avg_latency_ms ?? 0)) + " ms"),
      makeCard("بدون شواهد", totals.no_evidence_count ?? 0),
      makeCard("بازخورد مثبت", feedback.helpful ?? 0, "از " + (feedback.total ?? 0) + " بازخورد")
    );

    fill("#channels", data.channels, (item) =>
      makeRow(item.channel, item.count + " درخواست")
    );

    fill("#top-questions", data.top_questions, (item) =>
      makeRow(item.question_preview, item.count + " بار")
    );

    fill("#missing-topics", data.missing_topics, (item) =>
      makeRow(item.question_preview, item.count + " بار بدون شواهد")
    );

    fill("#low-confidence", data.low_confidence, (item) =>
      makeRow(
        item.question_preview,
        item.channel + " • " + item.evidence_status + " • confidence: " + (item.confidence_score ?? "-")
      )
    );

    resultEl.classList.remove("hidden");
  } catch (error) {
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  }
});
