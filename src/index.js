const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const text = (data, status = 200) => new Response(data, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const nowUnix = () => Math.floor(Date.now() / 1000);
const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const pence = (v) => { const n = Number(String(v ?? "").replace(/[£,\s]/g, "")); if (!Number.isFinite(n) || n < 0) throw new Error("Invalid product price"); return Math.round(n * 100); };
const safeReturnUrl = (request, kind) => { const u = new URL(request.url); u.pathname = "/"; u.search = ""; u.searchParams.set("payment", kind); return u.toString(); };
function constantTimeEqual(a, b) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function isTestMode(env) { return String(env.PAYMENT_MODE || "test").toLowerCase() !== "live"; }
function requireAdmin(request, env) { return !!env.ADMIN_TOKEN && constantTimeEqual(request.headers.get("X-Admin-Token") || "", env.ADMIN_TOKEN); }
async function stripeRequest(env, path, params, key, method = "POST") {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured. Live/test connections are intentionally a final setup step.");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(method !== "GET" ? { body: params?.toString() || "" } : {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Stripe request failed (${res.status})`);
  return data;
}
async function verifyStripeSignature(raw, header, secret) {
  const fields = header.split(",").map(s => s.split("=")); const timestamp = fields.find(x => x[0] === "t")?.[1]; const signatures = fields.filter(x => x[0] === "v1").map(x => x[1]);
  if (!timestamp || !signatures.length || Math.abs(nowUnix() - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return signatures.some(s => constantTimeEqual(hex, s));
}
function emailPayload(order, kind) {
  const items = JSON.parse(order.items_json || "[]");
  const pounds = n => `£${(Number(n || 0) / 100).toFixed(2)}`;
  const summary = items.map(x => `${x.name} × ${x.quantity} — ${pounds(x.line_total_pence)}`).join("\n");
  const common = { orderId: order.id, customerName: order.customer_name || "Customer", email: order.email || "", items: summary, subtotal: pounds(order.subtotal_pence), delivery: pounds(order.delivery_pence), total: pounds(order.total_pence) };
  if (kind === "owner_order_alert") return { recipient: null, subject: `AEC Arts — paid order ${order.id}`, payload: { ...common, type: kind, message: "Payment confirmed by verified Stripe event. Review the order in the private admin panel." } };
  if (kind === "dispatch_notice") return { recipient: order.email, subject: `Your AEC Arts order ${order.id} has been dispatched`, payload: { ...common, type: kind, message: "Your order has been marked as dispatched." } };
  if (kind === "refund_notice") return { recipient: order.email, subject: `AEC Arts refund update for order ${order.id}`, payload: { ...common, type: kind, message: "Stripe has confirmed the refund event." } };
  return { recipient: order.email, subject: `AEC Arts order confirmation ${order.id}`, payload: { ...common, type: "order_confirmation", message: "Your payment has been confirmed." } };
}
async function queueEmail(env, order, kind) {
  const mail = emailPayload(order, kind); const recipient = kind === "owner_order_alert" ? String(env.OWNER_EMAIL || "doctor-orgone@hotmail.com").trim() : String(mail.recipient || "").trim();
  if (!recipient) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO email_outbox (id,order_id,kind,recipient,subject,payload_json,status) VALUES (?,?,?,?,?,?,'queued')`).bind(id("mail"), order.id, kind, recipient, mail.subject, JSON.stringify(mail.payload)).run();
}
async function getOrder(env, orderId) { return env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first(); }
async function checkout(request, env) {
  if (!env.DB || !env.STRIPE_SECRET_KEY) return json({ error: "Payment backend is not connected yet. The shop is still in safe pre-launch mode." }, 503);
  const testMode = isTestMode(env);
  if (testMode && !String(env.STRIPE_SECRET_KEY).startsWith("sk_test_")) return json({ error: "Safety stop: test mode requires a Stripe test secret key." }, 503);
  if (!testMode && env.ALLOW_LIVE_PAYMENTS !== "yes") return json({ error: "Live payments are locked. The owner must explicitly enable live payments after launch checks." }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid checkout request." }, 400); }
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) return json({ error: "Your basket is empty or contains too many items." }, 400);
  const delivery = Number(env.DELIVERY_AMOUNT_PENCE);
  if (!Number.isInteger(delivery) || delivery < 0 || env.DELIVERY_CONFIGURED !== "yes") return json({ error: "Delivery pricing must be explicitly configured before checkout can be enabled." }, 503);
  const ids = body.items.map(x => String(x.id || "")); if (new Set(ids).size !== ids.length) return json({ error: "Duplicate product rows detected. Refresh your basket and try again." }, 400);
  const records = []; let subtotal = 0;
  for (const item of body.items) {
    const pid = String(item.id || ""); const qty = Number(item.quantity);
    if (!pid || !Number.isInteger(qty) || qty < 1 || qty > 20) return json({ error: "Invalid item quantity." }, 400);
    const product = await env.DB.prepare("SELECT id,name,description,category,price_pence,image,images_json,one_off,visible FROM products WHERE id=?").bind(pid).first();
    if (!product || !product.visible) return json({ error: "A product in your basket is unavailable. Please refresh the shop." }, 409);
    if (product.one_off && qty !== 1) return json({ error: "One-off products can only be purchased one at a time." }, 409);
    if (!Number.isInteger(product.price_pence) || product.price_pence <= 0) return json({ error: "A product has no valid price and cannot be checked out." }, 409);
    subtotal += product.price_pence * qty; records.push({ ...product, quantity: qty, line_total_pence: product.price_pence * qty });
  }
  const total = subtotal + delivery; const orderId = id("aec"); const expires = nowUnix() + 30 * 60;
  const itemsJson = JSON.stringify(records.map(p => ({ id: p.id, name: p.name, quantity: p.quantity, unit_price_pence: p.price_pence, line_total_pence: p.line_total_pence, one_off: !!p.one_off, image: p.image })));
  await env.DB.prepare("DELETE FROM one_off_locks WHERE expires_at < ?").bind(nowUnix()).run();
  const batch = [env.DB.prepare("INSERT INTO orders (id,currency,subtotal_pence,delivery_pence,total_pence,payment_status,items_json) VALUES (?,'gbp',?,?,?,'pending',?)").bind(orderId, subtotal, delivery, total, itemsJson)];
  for (const p of records.filter(p => p.one_off)) batch.push(env.DB.prepare("INSERT INTO one_off_locks (product_id,order_id,expires_at) VALUES (?,?,?)").bind(p.id, orderId, expires));
  try { await env.DB.batch(batch); } catch (e) { await env.DB.prepare("DELETE FROM orders WHERE id=?").bind(orderId).run(); return json({ error: "A one-off item may already be reserved in another checkout. Refresh the shop or try again shortly." }, 409); }
  const form = new URLSearchParams(); form.set("mode", "payment"); form.set("success_url", `${safeReturnUrl(request, "success")}&session_id={CHECKOUT_SESSION_ID}`); form.set("cancel_url", safeReturnUrl(request, "cancelled")); form.set("expires_at", String(expires)); form.set("billing_address_collection", "required"); form.set("shipping_address_collection[allowed_countries][0]", "GB"); form.set("phone_number_collection[enabled]", "true"); form.set("client_reference_id", orderId); form.set("metadata[order_id]", orderId); form.set("payment_intent_data[metadata][order_id]", orderId);
  form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount"); form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(delivery)); form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "gbp"); form.set("shipping_options[0][shipping_rate_data][display_name]", "UK delivery");
  records.forEach((p, i) => { form.set(`line_items[${i}][price_data][currency]`, "gbp"); form.set(`line_items[${i}][price_data][unit_amount]`, String(p.price_pence)); form.set(`line_items[${i}][price_data][product_data][name]`, p.name); form.set(`line_items[${i}][quantity]`, String(p.quantity)); });
  try { const session = await stripeRequest(env, "checkout/sessions", form, orderId); await env.DB.prepare("UPDATE orders SET stripe_session_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(session.id, orderId).run(); return json({ url: session.url, orderId, mode: testMode ? "test" : "live" }); }
  catch (e) { await env.DB.batch([env.DB.prepare("UPDATE orders SET payment_status='checkout_error',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(orderId), env.DB.prepare("DELETE FROM one_off_locks WHERE order_id=?").bind(orderId)]); return json({ error: e.message || "Could not create secure checkout." }, 502); }
}
async function syncCatalogue(request, env) {
  if (!requireAdmin(request, env)) return json({ error: "Admin token is incorrect." }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid catalogue data." }, 400); }
  if (!Array.isArray(body.products) || body.products.length > 1000 || !Array.isArray(body.categories)) return json({ error: "Catalogue payload is invalid." }, 400);
  let count = 0;
  for (const p of body.products) {
    if (!p.id || !p.name || !String(p.name).trim()) continue;
    let price; try { price = pence(p.price); } catch { price = 0; }
    const images = Array.isArray(p.images) ? p.images.filter(x => typeof x === "string" && !x.startsWith("data:")).slice(0, 20) : [];
    const image = typeof p.image === "string" && !p.image.startsWith("data:") ? p.image : (images[0] || "");
    const soldLock = p.oneOff ? await env.DB.prepare("SELECT product_id FROM one_off_locks WHERE product_id=? AND expires_at=2147483647").bind(String(p.id)).first() : null;
    const visible = soldLock ? 0 : (p.visible === false ? 0 : 1);
    await env.DB.prepare(`INSERT INTO products (id,name,description,category,price_pence,image,images_json,one_off,visible,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,price_pence=excluded.price_pence,image=excluded.image,images_json=excluded.images_json,one_off=excluded.one_off,visible=excluded.visible,updated_at=CURRENT_TIMESTAMP`).bind(String(p.id), String(p.name).slice(0, 240), String(p.description || "").slice(0, 20000), String(p.category || "Other").slice(0, 120), price, image, JSON.stringify(images), p.oneOff ? 1 : 0, visible).run(); count++;
  }
  await env.DB.prepare("INSERT INTO shop_settings(key,value_json,updated_at) VALUES ('categories',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP").bind(JSON.stringify(body.categories)).run();
  return json({ ok: true, products: count });
}
async function webhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.DB) return text("Webhook not configured", 503);
  const raw = await request.text(); const sig = request.headers.get("Stripe-Signature") || ""; if (!await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET)) return text("Invalid signature", 400);
  let event; try { event = JSON.parse(raw); } catch { return text("Invalid event", 400); }
  if (!event.id || !event.type) return text("Invalid event", 400);
  if (await env.DB.prepare("SELECT event_id FROM stripe_events WHERE event_id=?").bind(event.id).first()) return text("ok");
  const obj = event.data?.object || {}; let orderId = obj.metadata?.order_id || obj.client_reference_id;
  if (event.type === "charge.refunded" && obj.payment_intent) { const o = await env.DB.prepare("SELECT id FROM orders WHERE payment_intent_id=?").bind(obj.payment_intent).first(); orderId = o?.id || orderId; }
  const operations = [];
  if (orderId) {
    let order = await getOrder(env, orderId);
    if (order) {
      if ((event.type === "checkout.session.completed" && obj.payment_status === "paid") || event.type === "checkout.session.async_payment_succeeded") {
        const shipping = obj.shipping_details || {}; const customer = obj.customer_details || {};
        operations.push(env.DB.prepare("UPDATE orders SET payment_status='paid',payment_intent_id=?,email=COALESCE(?,email),customer_name=COALESCE(?,customer_name),shipping_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(obj.payment_intent || null, customer.email || obj.customer_email || null, customer.name || null, JSON.stringify(shipping), orderId));
        operations.push(env.DB.prepare("UPDATE one_off_locks SET expires_at=2147483647 WHERE order_id=?").bind(orderId));
        for (const item of JSON.parse(order.items_json || "[]").filter(x => x.one_off)) operations.push(env.DB.prepare("UPDATE products SET visible=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id));
        const updated = { ...order, payment_status: "paid", payment_intent_id: obj.payment_intent || order.payment_intent_id, email: customer.email || obj.customer_email || order.email, customer_name: customer.name || order.customer_name, shipping_json: JSON.stringify(shipping) };
        if (updated.email) operations.push(env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,order_id,kind,recipient,subject,payload_json,status) VALUES (?,?,?,?,?,?,'queued')").bind(id("mail"), updated.id, "order_confirmation", updated.email, emailPayload(updated, "order_confirmation").subject, JSON.stringify(emailPayload(updated, "order_confirmation").payload)));
        const owner = String(env.OWNER_EMAIL || "doctor-orgone@hotmail.com").trim(); if (owner) { const mail = emailPayload(updated, "owner_order_alert"); operations.push(env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,order_id,kind,recipient,subject,payload_json,status) VALUES (?,?,?,?,?,?,'queued')").bind(id("mail"), updated.id, "owner_order_alert", owner, mail.subject, JSON.stringify(mail.payload))); }
      } else if (event.type === "checkout.session.expired") {
        operations.push(env.DB.prepare("UPDATE orders SET payment_status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND payment_status='pending'").bind(orderId)); operations.push(env.DB.prepare("DELETE FROM one_off_locks WHERE order_id=?").bind(orderId));
      } else if (event.type === "checkout.session.async_payment_failed") {
        operations.push(env.DB.prepare("UPDATE orders SET payment_status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND payment_status='pending'").bind(orderId)); operations.push(env.DB.prepare("DELETE FROM one_off_locks WHERE order_id=?").bind(orderId));
      } else if (event.type === "charge.refunded") {
        operations.push(env.DB.prepare("UPDATE orders SET payment_status='refunded',refund_status='succeeded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(orderId));
        const updated = { ...order, payment_status: "refunded" }; if (updated.email) { const mail = emailPayload(updated, "refund_notice"); operations.push(env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,order_id,kind,recipient,subject,payload_json,status) VALUES (?,?,?,?,?,?,'queued')").bind(id("mail"), updated.id, "refund_notice", updated.email, mail.subject, JSON.stringify(mail.payload))); }
      }
    }
  }
  operations.push(env.DB.prepare("INSERT INTO stripe_events(event_id) VALUES (?)").bind(event.id));
  try { await env.DB.batch(operations); } catch (e) { if (await env.DB.prepare("SELECT event_id FROM stripe_events WHERE event_id=?").bind(event.id).first()) return text("ok"); return text("Event processing failed; provider should retry.", 500); }
  return text("ok");
}
async function adminOrders(request, env) {
  if (!requireAdmin(request, env)) return json({ error: "Admin token is incorrect." }, 401);
  const rows = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 250").all();
  return json({ orders: (rows.results || []).map(o => ({ ...o, items: JSON.parse(o.items_json || "[]"), shipping: safeJson(o.shipping_json) })) });
}
function safeJson(v) { try { return v ? JSON.parse(v) : null; } catch { return null; } }
async function fulfilOrder(request, env, orderId) {
  if (!requireAdmin(request, env)) return json({ error: "Admin token is incorrect." }, 401);
  const order = await getOrder(env, orderId); if (!order) return json({ error: "Order not found." }, 404);
  if (order.payment_status !== "paid") return json({ error: "Only a verified paid order can be marked as dispatched." }, 409);
  await env.DB.prepare("UPDATE orders SET fulfilment_status='dispatched',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(orderId).run();
  const fresh = await getOrder(env, orderId); if (fresh.email) await queueEmail(env, fresh, "dispatch_notice");
  return json({ ok: true, orderId, fulfilment_status: "dispatched", email: "queued_only" });
}
async function refundOrder(request, env, orderId) {
  if (!requireAdmin(request, env)) return json({ error: "Admin token is incorrect." }, 401);
  const order = await getOrder(env, orderId); if (!order) return json({ error: "Order not found." }, 404);
  if (order.payment_status !== "paid" || !order.payment_intent_id) return json({ error: "Only a verified paid order can be refunded." }, 409);
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe is not configured. No refund was attempted." }, 503);
  if (isTestMode(env) && !String(env.STRIPE_SECRET_KEY).startsWith("sk_test_")) return json({ error: "Safety stop: test mode requires a Stripe test secret key." }, 503);
  if (!isTestMode(env) && env.ALLOW_LIVE_PAYMENTS !== "yes") return json({ error: "Live refunds are locked until explicitly enabled." }, 503);
  const form = new URLSearchParams(); form.set("payment_intent", order.payment_intent_id);
  try { const r = await stripeRequest(env, "refunds", form, `aec-refund-${orderId}`); await env.DB.prepare("UPDATE orders SET refund_status='pending',refund_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(r.id, orderId).run(); return json({ ok: true, orderId, refund_status: r.status || "pending", note: "Final status comes from Stripe's verified webhook." }); }
  catch (e) { return json({ error: e.message || "Refund request failed." }, 502); }
}
async function adminOutbox(request, env) {
  if (!requireAdmin(request, env)) return json({ error: "Admin token is incorrect." }, 401);
  const rows = await env.DB.prepare("SELECT id,order_id,kind,recipient,subject,payload_json,status,attempts,last_error,created_at,updated_at FROM email_outbox ORDER BY created_at DESC LIMIT 250").all();
  return json({ mode: String(env.EMAIL_MODE || "queue_only"), outbox: (rows.results || []).map(m => ({ ...m, payload: safeJson(m.payload_json) })) });
}
async function retryOutbox(request, env, mailId) {
  if (!requireAdmin(request, env)) return json({ error: "Admin token is incorrect." }, 401);
  const r = await env.DB.prepare("UPDATE email_outbox SET status='queued',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('failed','queued')").bind(mailId).run();
  if (!r.meta?.changes) return json({ error: "Message not found or not eligible for retry." }, 404);
  return json({ ok: true, note: "Message re-queued only; no email has been sent. Live delivery is a separate final connection step." });
}
async function health(env) {
  let db = false; try { await env.DB.prepare("SELECT 1 AS ok").first(); db = true; } catch {}
  return json({ ok: true, service: "aec-arts-shop-backend", mode: isTestMode(env) ? "test" : "live", database: db ? "connected" : "not_configured", stripeKeyConfigured: !!env.STRIPE_SECRET_KEY, stripeKeyMode: env.STRIPE_SECRET_KEY ? (String(env.STRIPE_SECRET_KEY).startsWith("sk_test_") ? "test" : String(env.STRIPE_SECRET_KEY).startsWith("sk_live_") ? "live" : "unknown") : "missing", webhookConfigured: !!env.STRIPE_WEBHOOK_SECRET, deliveryConfigured: env.DELIVERY_CONFIGURED === "yes", emailMode: String(env.EMAIL_MODE || "queue_only"), ownerEmailConfigured: !!String(env.OWNER_EMAIL || "").trim(), livePaymentsEnabled: env.ALLOW_LIVE_PAYMENTS === "yes" });
}
export default {
  async fetch(request, env) {
    const u = new URL(request.url); if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-Admin-Token,Stripe-Signature" } });
    if (!u.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (u.pathname === "/api/health" && request.method === "GET") return health(env);
    if (u.pathname === "/api/checkout" && request.method === "POST") return checkout(request, env);
    if (u.pathname === "/api/stripe/webhook" && request.method === "POST") return webhook(request, env);
    if (u.pathname === "/api/admin/catalogue" && request.method === "PUT") return syncCatalogue(request, env);
    if (u.pathname === "/api/admin/orders" && request.method === "GET") return adminOrders(request, env);
    if (u.pathname === "/api/admin/outbox" && request.method === "GET") return adminOutbox(request, env);
    let m = u.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/(fulfil|refund)$/);
    if (m && request.method === "POST") return m[2] === "fulfil" ? fulfilOrder(request, env, decodeURIComponent(m[1])) : refundOrder(request, env, decodeURIComponent(m[1]));
    m = u.pathname.match(/^\/api\/admin\/outbox\/([^/]+)\/retry$/);
    if (m && request.method === "POST") return retryOutbox(request, env, decodeURIComponent(m[1]));
    return json({ error: "Not found" }, 404);
  }
};
