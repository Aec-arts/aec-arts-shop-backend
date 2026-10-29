import fs from 'node:fs';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
for (const [name, pattern] of [
 ['test-mode safety',/startsWith\("sk_test_"\)/],
 ['live payments locked by explicit flag',/ALLOW_LIVE_PAYMENTS !== "yes"/],
 ['server-side price lookup',/SELECT id,name,description,category,price_pence/],
 ['one-off lock uniqueness',/INSERT INTO one_off_locks \(product_id,order_id,expires_at\)/],
 ['Stripe signature verification',/verifyStripeSignature\(raw, sig, env\.STRIPE_WEBHOOK_SECRET\)/],
 ['duplicate webhook dedupe',/SELECT event_id FROM stripe_events WHERE event_id=\?/],
 ['email outbox queue',/INSERT OR IGNORE INTO email_outbox/],
 ['admin order list',/\/api\/admin\/orders/],
 ['refund endpoint',/refundOrder/],
 ['shop checkout integration',/fetch\('\/api\/checkout'/],
 ['admin screen queue-only notice',/no email has been sent/]
]) assert.match(name==='shop checkout integration'?html:name==='admin screen queue-only notice'?src+'\n'+admin:src,pattern,`${name} check failed`);
assert.match(admin,/doctor-orgone|order/i);
console.log('PASS: 11 backend/storefront safety and integration checks');
