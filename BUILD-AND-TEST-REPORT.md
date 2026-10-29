# AEC Arts Backend v2 — build checks

Date: 2026-10-29

## Source files
- Baseline storefront: `public/index.html`, copied from the most recent available `AEC-Arts-Shopfront-Payment-Integrated.html` (not the older starter HTML).
- Backend Worker: `src/index.js`.
- Private order panel: `public/admin.html`.
- Migrations: `migrations/0001_init.sql`, `0002_seed_template_catalogue.sql`, `0003_orders_email_and_unique_items.sql`.
- Offline payment rehearsal: `offline-test-lab/AEC-Arts-Payment-Simulator.html`.

## Checks run in this build
- Worker JavaScript syntax: PASS (`node --check src/index.js`).
- Static safety/integration assertions: PASS (11 assertions).
- Inline JavaScript syntax in storefront: PASS.
- Inline JavaScript syntax in private admin panel: PASS.
- All three SQL migrations applied in SQLite: PASS.
- Seed catalogue row count: 21 products.
- Email outbox duplicate `(order_id, kind)` prevention: PASS.
- One-off product lock uniqueness: PASS.

## Not yet tested / not claimed
- No deployment to the user's Cloudflare account has occurred.
- No D1 database has been created or modified.
- No Stripe key or webhook secret has been connected.
- No Stripe test-mode payment/webhook round-trip has been run.
- No email provider is connected; the backend queues message records only.
- No live payments or emails have been sent.

These checks establish that the package parses and its SQL constraints behave in a disposable SQLite test, not that production infrastructure is already connected.
