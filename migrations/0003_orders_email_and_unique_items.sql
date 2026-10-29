-- AEC Arts backend v2: durable email outbox, refund tracking, and one-off reservations.
ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN refund_id TEXT;
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status, created_at DESC);
CREATE TABLE IF NOT EXISTS one_off_locks (
  product_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_one_off_locks_expiry ON one_off_locks(expires_at);
