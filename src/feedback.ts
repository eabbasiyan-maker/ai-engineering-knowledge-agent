import type { Env } from "./env";

export interface FeedbackInput {
  request_id: string;
  helpful: boolean;
  comment?: string | null;
  channel?: string | null;
}

export async function saveFeedback(env: Env, input: FeedbackInput) {
  const feedbackId = crypto.randomUUID();
  const comment = input.comment?.trim().slice(0, 1000) || null;
  const channel = input.channel?.trim().slice(0, 32) || null;

  await env.DB.prepare(
    `INSERT INTO answer_feedback
      (feedback_id, request_id, helpful, comment, channel, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    feedbackId,
    input.request_id,
    input.helpful ? 1 : 0,
    comment,
    channel
  ).run();

  return {
    ok: true,
    feedback_id: feedbackId,
    request_id: input.request_id
  };
}
