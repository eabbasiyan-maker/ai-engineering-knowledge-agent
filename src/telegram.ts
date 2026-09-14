import type { Env } from "./env";
import { answerQuestion } from "./agent";

type TelegramMessage = {
  message_id: number;
  chat: { id: number | string };
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

function trimForTelegram(text: string, max = 3200) {
  const value = text.trim();
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + "…";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    supported: "پشتیبانی‌شده",
    partial: "شواهد ناکامل",
    no_evidence: "بدون شواهد کافی",
    conflict: "تعارض منابع"
  };
  return map[status] ?? status;
}

function formatAnswer(result: any) {
  const lines: string[] = [];
  lines.push(trimForTelegram(String(result.answer ?? "")));

  const confidence = result.confidence;
  lines.push("");
  lines.push(
    `وضعیت شواهد: ${statusLabel(String(result.evidence_status ?? "-"))}`
  );
  if (confidence) {
    lines.push(
      `اطمینان: ${confidence.level ?? "-"}${confidence.score != null ? ` (${confidence.score})` : ""}`
    );
  }

  const sources = Array.isArray(result.sources) ? result.sources.slice(0, 3) : [];
  if (sources.length) {
    lines.push("");
    lines.push("منابع:");
    for (const source of sources) {
      const location = [source.chapter, source.section].filter(Boolean).join(" / ");
      const suffix = location ? ` — ${location}` : "";
      lines.push(
        `[${source.id}] ${source.title || source.source_id}${suffix}`
      );
    }
  }

  return trimForTelegram(lines.join("\n"), 3900);
}

async function telegramApi(env: Env, method: string, body: Record<string, unknown>) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram bot token is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  const payload = await response.json<any>().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      `Telegram API ${method} failed: ${response.status} ${JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function sendMessage(env: Env, chatId: string | number, text: string) {
  return telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

export function verifyTelegramWebhook(request: Request, env: Env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return false;
  const provided =
    request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return provided === env.TELEGRAM_WEBHOOK_SECRET;
}

export function verifyTelegramSetupSecret(request: Request, env: Env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return false;
  const provided = request.headers.get("x-telegram-setup-secret") ?? "";
  return provided === env.TELEGRAM_WEBHOOK_SECRET;
}

export async function configureTelegramWebhook(env: Env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error("Telegram secrets are not configured");
  }

  const webhookUrl =
    "https://ai-engineering-knowledge-agent.e-abbasiyan.workers.dev/api/v1/telegram/webhook";

  const me = await telegramApi(env, "getMe", {});
  await telegramApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true
  });

  const info = await telegramApi(env, "getWebhookInfo", {});
  const result = info?.result ?? {};

  return {
    ok: result.url === webhookUrl,
    bot: {
      id: me?.result?.id ?? null,
      username: me?.result?.username ?? null,
      first_name: me?.result?.first_name ?? null
    },
    webhook: {
      url: result.url ?? null,
      pending_update_count: result.pending_update_count ?? 0,
      last_error_message: result.last_error_message ?? null
    }
  };
}

export async function handleTelegramUpdate(env: Env, update: TelegramUpdate) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const text = message.text?.trim();

  if (!text) {
    await sendMessage(
      env,
      chatId,
      "فعلاً فقط پیام متنی پشتیبانی می‌شود. سؤال خودت را به‌صورت متن بفرست."
    );
    return;
  }

  if (text === "/start" || text === "/help") {
    await sendMessage(
      env,
      chatId,
      "سؤال مهندسی هوش مصنوعی‌ات را بفرست. پاسخ فقط از پایگاه دانش تأییدشده ساخته می‌شود و منبع و سطح اطمینان هم نمایش داده می‌شود."
    );
    return;
  }

  if (text.length > 4000) {
    await sendMessage(
      env,
      chatId,
      "سؤال خیلی طولانی است. لطفاً آن را کوتاه‌تر از ۴۰۰۰ کاراکتر بفرست."
    );
    return;
  }

  try {
    await telegramApi(env, "sendChatAction", {
      chat_id: chatId,
      action: "typing"
    });

    const result = await answerQuestion(env, {
      question: text,
      channel: "telegram",
      top_k: 8
    });

    await sendMessage(env, chatId, formatAnswer(result));
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : "";

    const busy =
      message.includes("429") ||
      message.includes("rate") ||
      message.includes("capacity");

    await sendMessage(
      env,
      chatId,
      busy
        ? "سرویس هوش مصنوعی فعلاً شلوغ است. چند لحظه بعد دوباره امتحان کن."
        : "در پردازش سؤال خطایی رخ داد. لطفاً دوباره تلاش کن."
    ).catch(() => undefined);
  }
}

export type { TelegramUpdate };
