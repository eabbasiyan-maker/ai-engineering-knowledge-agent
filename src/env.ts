export interface Env {
  DB: D1Database;
  KNOWLEDGE_R2?: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  ADMIN_TOKEN: string;
  EMBEDDING_MODEL: string;
  GENERATION_MODEL?: string;
  MIN_RETRIEVAL_SCORE?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}
