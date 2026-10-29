PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Other',
 price_pence INTEGER NOT NULL CHECK(price_pence >= 0), image TEXT NOT NULL DEFAULT '', images_json TEXT NOT NULL DEFAULT '[]',
 one_off INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, stripe_session_id TEXT UNIQUE, payment_intent_id TEXT, email TEXT, customer_name TEXT,
 currency TEXT NOT NULL DEFAULT 'gbp', subtotal_pence INTEGER NOT NULL, delivery_pence INTEGER NOT NULL,
 total_pence INTEGER NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending', fulfilment_status TEXT NOT NULL DEFAULT 'new',
 items_json TEXT NOT NULL, shipping_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stripe_events (event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS shop_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
