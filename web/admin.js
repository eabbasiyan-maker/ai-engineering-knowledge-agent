const API_BASE = "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev";

const form = document.getElementById("analytics-form");
const tokenEl = document.getElementById("token");
const daysEl = document.getElementById("days");
const errorEl = document.getElementById("analytics-error");
const resultEl = document.getElementById("analytics-result");

const statusLabels = {
  supported: "مستند",
  no_evidence: "مدرک ناکافی — Agent جواب قطعی نساخت",
  partial: "نیمه‌مستند",
  conflict: "اختلاف منابع"
};

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideError() {
  errorEl.classList.add("hidden");
  errorEl.textContent = "";
}

function faNumber(value) {
  return Number(value ?? 0).toLocaleString("fa-IR");
}

function percent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value) * 100).toLocaleString("fa-IR") + "٪";
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

function fill(selector, items, renderer, emptyText = "داده‌ای وجود ندارد") {
  const root = document.querySelector(selector);
  root.replaceChildren();
  if (!items || items.length === 0) {
    root.append(makeRow(emptyText, ""));
    return;
  }
  for (const item of items) root.append(renderer(item));
}

function renderPlainSummary(data) {
  const root = document.getElementById("plain-summary");
  const traffic = data.traffic || {};
  const totals = data.totals || {};
  const userCount = Number(traffic.user_requests ?? 0);
  const testCount = Number(traffic.automated_test_requests ?? 0);
  const supported = Number(totals.supported_count ?? 0);
  const noEvidence = Number(totals.no_evidence_count ?? 0);
  const partial = Number(totals.partial_count ?? 0);
  const conflicts = Number(totals.conflict_count ?? 0);

  const lines = [];

  if (userCount === 0) {
    lines.push("در این بازه هنوز درخواست واقعی کافی ثبت نشده است؛ بنابراین از این صفحه نمی‌شود درباره رفتار کاربران نتیجه گرفت.");
  } else {
    lines.push(
      `از ${faNumber(userCount)} درخواست واقعی، ${faNumber(supported)} جواب مستند بوده (${percent(totals.supported_rate)}).`
    );
    if (noEvidence > 0) {
      lines.push(
        `در ${faNumber(noEvidence)} مورد مدرک کافی وجود نداشته و Agent عمداً جواب قطعی نساخته؛ این رفتار ضد Hallucination است، نه نامطمئن‌بودن سیستم.`
      );
    }
    if (partial > 0) {
      lines.push(`${faNumber(partial)} جواب فقط بخشی از سؤال را با مدرک پوشش داده و بهتر است بررسی شود.`);
    }
    if (conflicts > 0) {
      lines.push(`${faNumber(conflicts)} مورد اختلاف واقعی بین منابع ثبت شده و Agent باید هر دو دیدگاه را نشان دهد.`);
    }
  }

  if (testCount > 0) {
    lines.push(`${faNumber(testCount)} درخواست تست خودکار جدا شناسایی شده و در آمار استفاده واقعی بالا حساب نشده است.`);
  }

  root.replaceChildren();
  for (const line of lines) {
    const p = document.createElement("p");
    p.style.margin = "4px 0";
    p.textContent = line;
    root.append(p);
  }
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

    renderPlainSummary(data);

    const totals = data.totals || {};
    const traffic = data.traffic || {};
    const feedback = data.feedback || {};
    const cards = document.getElementById("summary-cards");
    cards.replaceChildren(
      makeCard(
        "درخواست واقعی",
        faNumber(traffic.user_requests ?? 0),
        "تست‌های خودکار از این عدد حذف شده‌اند"
      ),
      makeCard(
        "جواب مستند",
        faNumber(totals.supported_count ?? 0),
        "نرخ مستند: " + percent(totals.supported_rate)
      ),
      makeCard(
        "مدرک ناکافی",
        faNumber(totals.no_evidence_count ?? 0),
        "Agent در این موارد جواب قطعی نساخته"
      ),
      makeCard(
        "تست خودکار جداشده",
        faNumber(traffic.automated_test_requests ?? 0),
        "برای کنترل کیفیت؛ نه استفاده واقعی"
      ),
      makeCard(
        "میانگین زمان پاسخ واقعی",
        faNumber(Math.round(Number(totals.avg_latency_ms ?? 0))) + " ms",
        "فقط درخواست‌های واقعی"
      ),
      makeCard(
        "بازخورد مثبت واقعی",
        faNumber(feedback.helpful ?? 0),
        "از " + faNumber(feedback.total ?? 0) + " بازخورد واقعی"
      )
    );

    fill("#evidence-statuses", data.evidence_statuses, (item) =>
      makeRow(
        statusLabels[item.evidence_status] || item.evidence_status,
        faNumber(item.count) + " درخواست واقعی"
      ),
      "هنوز درخواست واقعی برای نمایش وضعیت جواب‌ها نداریم"
    );

    fill("#channels", data.channels, (item) =>
      makeRow(item.channel, faNumber(item.count) + " درخواست واقعی"),
      "هنوز استفاده واقعی از کانال‌ها ثبت نشده"
    );

    fill("#top-questions", data.top_questions, (item) =>
      makeRow(item.question_preview, faNumber(item.count) + " بار از کاربران واقعی"),
      "فعلاً سؤال واقعی پرتکراری نداریم"
    );

    fill("#missing-topics", data.missing_topics, (item) =>
      makeRow(
        item.question_preview,
        faNumber(item.count) + " بار بدون مدرک کافی — کاندید توسعه Knowledge Base"
      ),
      "فعلاً Knowledge Gap پرتکراری از کاربران واقعی دیده نشده"
    );

    fill("#low-confidence", data.low_confidence, (item) => {
      const status = statusLabels[item.evidence_status] || item.evidence_status;
      const strength = item.confidence_score == null
        ? "قدرت شواهد: ثبت نشده"
        : "قدرت شواهد: " + Math.round(Number(item.confidence_score) * 100).toLocaleString("fa-IR") + "٪";
      return makeRow(
        item.question_preview,
        `${item.channel} • ${status} • ${strength}`
      );
    }, "فعلاً پاسخ واقعی نیازمند بررسی ثبت نشده");

    const automated = data.automated_tests || {};
    const testTotals = automated.totals || {};
    const testItems = [
      {
        title: "کل تست‌های خودکار",
        meta: faNumber(testTotals.request_count ?? 0) + " درخواست"
      },
      {
        title: "تست‌های مستند",
        meta: faNumber(testTotals.supported_count ?? 0) + " مورد"
      },
      {
        title: "تست‌های No-Evidence",
        meta: faNumber(testTotals.no_evidence_count ?? 0) + " مورد — برای کنترل ضد Hallucination"
      },
      {
        title: "تست اختلاف منابع",
        meta: faNumber(testTotals.conflict_count ?? 0) + " مورد"
      }
    ];

    fill("#automated-tests", testItems, (item) => makeRow(item.title, item.meta));

    resultEl.classList.remove("hidden");
  } catch (error) {
    showError(error instanceof Error ? error.message : "خطای ناشناخته");
  }
});
