# AEC Arts Shop Backend v2 — safe pre-launch package

This package extends the current AEC Arts storefront with a Cloudflare Worker + D1 backend and private order-control page. It is **not deployed and is not connected to a real Stripe account or email sender**. It must not be treated as launch-ready until the test environment is deployed and exercised.

## Included
- `public/index.html`: existing integrated AEC Arts storefront, preserved as the baseline.
- `public/admin.html`: private order list, fulfilment action, refund request and email-outbox viewer. Every API action requires the private admin token.
- `src/index.js`: server-side product-price lookup, Stripe Checkout session creation, test/live safety lock, signed webhook verification, webhook idempotency, D1 orders, one-off item reservations, refund request handling, fulfilment state and queue-only email records.
- `migrations/0001_init.sql` + `0002_seed_template_catalogue.sql`: initial tables and existing 21-product template seed.
- `migrations/0003_orders_email_and_unique_items.sql`: email outbox, refund status and unique-item lock tables.
- `wrangler.toml`: AEC-specific Worker and D1 binding placeholder.
- `tests/static-check.mjs`: basic integration/safety assertions.

## Critical safe defaults
- `PAYMENT_MODE = "test"`.
- Test mode refuses a non-`sk_test_` Stripe key.
- Live payment/refund routes require both `PAYMENT_MODE=live` and the separate `ALLOW_LIVE_PAYMENTS=yes` secret/variable.
- Delivery remains disabled until the owner explicitly sets a real charge and `DELIVERY_CONFIGURED=yes`.
- `EMAIL_MODE=queue_only`: successful payment, dispatch and refund events create email records, but no email is sent.
- Owner order alerts target `doctor-orgone@hotmail.com` by default. Customer messages only queue when a customer email is available.
- No secret/API keys are embedded in HTML or source.
- One-off product reservation locks for 30 minutes while checkout is open. A paid one-off is made invisible in the server catalogue and its lock is retained.
- Stripe event is recorded only in the same D1 batch as its business updates, so a failed batch can be retried by Stripe.

## Connection sequence — do not skip ahead
1. In Cloudflare, create a **new AEC-only D1 database** named `aec-arts-shop-orders`; do not reuse any Mon-Gen or POC database.
2. Set the exact D1 ID in `wrangler.toml`.
3. Apply migrations 0001, 0002 and 0003 in order.
4. Deploy the Worker/assets in Cloudflare preview first. Configure private Worker secrets `ADMIN_TOKEN`, `STRIPE_SECRET_KEY` (test key only) and `STRIPE_WEBHOOK_SECRET` (Stripe test webhook signing secret). Do not paste these into chat or commit them.
5. Set a confirmed delivery amount in pence and `DELIVERY_CONFIGURED=yes` only after the owner has decided the policy. Until then checkout deliberately refuses to start.
6. Open the preview storefront and use Workspace → Sync catalogue. The admin token is stored in session storage for that tab only. Sync after product/price changes.
7. Configure Stripe **test-mode** webhook to `/api/stripe/webhook` with `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `charge.refunded`.
8. Open `/admin.html`, enter the admin token and test orders, fulfilment and email queue. No mail sender is connected at this stage.
9. Test success, decline, cancel, expiry, webhook replay, duplicate webhook, unique-item concurrent checkout, refund and order persistence. Keep live payments disabled.
10. Only after all test results pass should live Stripe, sender authentication, email provider, domain and final legal/delivery policy be considered. Never overwrite existing Outlook MX records as part of email setup.

## Email queue status
The backend creates the intended messages:
- customer order confirmation only after a verified paid event;
- owner order alert to `doctor-orgone@hotmail.com` after verified payment;
- dispatch notice only after a paid order is marked dispatched;
- refund notice only after Stripe's verified refund webhook.

The outbox preview and retry action only inspect/requeue records. **They do not send email.** A provider adapter and authenticated sender must be connected and tested as a separate final step. The current setup does not change or interfere with the existing Outlook inbox.

## Verification
Run `npm run check` in a Node environment. Apply SQL migrations to a disposable SQLite/D1 test database and verify all tables exist. These checks are source-level checks, not proof of a deployed Cloudflare/Stripe integration. Deployment and Stripe test-mode end-to-end tests remain required.

## Important limitations to resolve before live launch
- Confirm whether the current customer checkout should require billing address, shipping address and phone; these are currently collected by Stripe Checkout.
- Confirm actual delivery charge, returns/refunds, privacy, terms, tax/VAT treatment and contact details.
- Email sender provider is intentionally unselected/unconnected.
- The current catalogue sync is owner-triggered, not a multi-user live CMS.
- Stock figures are not invented or decremented unless actual stock data and policy are configured.
- Full refunds only are supported by the admin action; partial refunds are not implemented.
- Test-mode payment and webhook integration has not been run against the user's Cloudflare account because no deployment access/credentials have been provided in this build step.
