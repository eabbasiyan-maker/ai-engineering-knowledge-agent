import type { Env } from "./env";

type RequestRow = {
  channel?: string | null;
  question_hash?: string | null;
  question_preview?: string | null;
  created_at?: string | null;
};

const CURATED_FREQUENT = [
  "RAG دقیقاً چیست و کجا استفاده می‌شود؟",
  "یک AI Agent خوب چه اجزایی دارد؟",
  "چطور کیفیت پاسخ‌های مدل را ارزیابی کنیم؟",
  "Reflection چه فرقی با Planning دارد؟"
];

const CURATED_RECENT = [
  "MCP چیست و چه کاربردی دارد؟",
  "چه زمانی از Multi-Agent استفاده کنیم؟",
  "چطور Hallucination را کمتر کنیم؟",
  "اولین قدم برای ساخت Agent چیست؟"
];

const AUTOMATED_TEST_QUESTIONS = new Set([
  "what are common react failure modes and how can they be mitigated?",
  "how does reflection complement planning in an ai agent?",
  "how can a react-style agent recover when a tool call fails?",
  "what are the limitations of the react pattern?",
  "reflection در ai agent چه کاربردی دارد؟",
  "what is the recommended orbital insertion burn for a crewed mission to neptune?",
  "according to the approved knowledge base, what exact accuracy percentage did react achieve on the mars rover benchmark?",
  "what exact percentage latency reduction does reflection provide compared with plain react?",
  "what are common react failure modes?"
]);

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isAutomated(row: RequestRow) {
  const channel = String(row.channel ?? "").toLowerCase();
  if (channel.startsWith("test_")) return true;
  const question = normalize(String(row.question_preview ?? "")).toLowerCase();
  if (AUTOMATED_TEST_QUESTIONS.has(question)) return true;
  return question.includes("mars rover benchmark") || question.includes("crewed mission to neptune");
}

function isSafePublicQuestion(value: string) {
  const text = normalize(value);
  if (text.length < 8 || text.length > 180) return false;
  const lower = text.toLowerCase();
  const blocked = [
    "[email]", "[phone]", "http://", "https://", "api key", "apikey",
    "password", "secret", "bearer ", "admin token", "توکن", "رمز عبور",
    "شماره موبایل", "شماره تلفن", "ایمیل من", "حساب من"
  ];
  return !blocked.some((item) => lower.includes(item));
}

function fillWithFallback(items: string[], fallback: string[]) {
  const out = [...items];
  for (const value of fallback) {
    if (out.length >= 4) break;
    if (!out.some((item) => item.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out.slice(0, 4);
}

export async function getPublicHome(env: Env) {
  const [library, requestRows] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM sources WHERE status IN ('active','active_secondary')) AS source_count,
         (SELECT COUNT(*) FROM knowledge_chunks WHERE status='active') AS chunk_count,
         (SELECT MAX(activated_at) FROM source_versions WHERE status='active') AS latest_activation`
    ).first<{ source_count: number; chunk_count: number; latest_activation: string | null }>(),
    env.DB.prepare(
      `SELECT channel, question_hash, question_preview, created_at
       FROM agent_requests
       WHERE created_at >= datetime('now', '-90 days')
       ORDER BY datetime(created_at) DESC
       LIMIT 2000`
    ).all<RequestRow>()
  ]);

  const safeRows = (requestRows.results ?? [])
    .filter((row) => !isAutomated(row))
    .filter((row) => isSafePublicQuestion(String(row.question_preview ?? "")));

  const grouped = new Map<string, {
    question: string;
    count: number;
    last_seen: string;
  }>();

  for (const row of safeRows) {
    const hash = String(row.question_hash ?? "");
    const question = normalize(String(row.question_preview ?? ""));
    if (!hash || !question) continue;
    const createdAt = String(row.created_at ?? "");
    const existing = grouped.get(hash);
    if (!existing) {
      grouped.set(hash, { question, count: 1, last_seen: createdAt });
    } else {
      existing.count += 1;
      if (createdAt > existing.last_seen) {
        existing.last_seen = createdAt;
        existing.question = question;
      }
    }
  }

  // Public homepage only exposes aggregated questions seen at least twice.
  // This avoids publishing one person's unique question as a public activity feed.
  const anonymousGroups = [...grouped.values()].filter((item) => item.count >= 2);

  const frequent = anonymousGroups
    .slice()
    .sort((a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen))
    .map((item) => item.question);

  const recent = anonymousGroups
    .slice()
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen))
    .map((item) => item.question);

  return {
    library: {
      active_books: Number(library?.source_count ?? 0),
      active_chunks: Number(library?.chunk_count ?? 0),
      latest_update: library?.latest_activation ?? null
    },
    topics: [
      {
        id: "agents",
        title: "ساخت Agent",
        description: "طراحی Agent، ابزارها و حافظه",
        icon: "agents"
      },
      {
        id: "rag",
        title: "RAG و جست‌وجو",
        description: "اتصال دانش و جست‌وجوی بهتر",
        icon: "database"
      },
      {
        id: "prompt",
        title: "پرامپت‌نویسی",
        description: "نوشتن دستور واضح برای مدل",
        icon: "edit"
      },
      {
        id: "evaluation",
        title: "ارزیابی و تست",
        description: "بررسی کیفیت پاسخ و خطاها",
        icon: "chart"
      }
    ],
    frequent_questions: fillWithFallback(frequent, CURATED_FREQUENT),
    recent_questions: fillWithFallback(recent, CURATED_RECENT),
    privacy_note: "سؤال‌های عمومی فقط به‌صورت تجمیعی نمایش داده می‌شوند؛ سؤال یکتای یک کاربر در فهرست عمومی منتشر نمی‌شود."
  };
}
