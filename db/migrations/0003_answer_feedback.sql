CREATE TABLE IF NOT EXISTS answer_feedback (
  feedback_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  helpful INTEGER NOT NULL CHECK (helpful IN (0, 1)),
  comment TEXT,
  channel TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_answer_feedback_request
  ON answer_feedback(request_id, created_at);
