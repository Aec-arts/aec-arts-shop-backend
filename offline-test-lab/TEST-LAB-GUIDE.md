# AEC Arts payment rehearsal — how to use the Test Lab

Open `AEC-Arts-Payment-Simulator.html` directly in a browser. It does not need Node, a local server, API keys, Stripe or a mail account. Data is stored in that browser's local storage. Use Export test records before resetting or changing machines.

## Exercise the customer journey
1. Add a normal product and a one-off product to the basket.
2. Try to increase a one-off quantity above one; it must be rejected.
3. Run a successful test payment. Check order totals, paid status, simulated stock decrement, customer receipt and owner alert.
4. Repeat with declined, cancelled, expired, delayed-failure and delayed-success scenarios.
5. In Orders & fulfilment, try event replay, fulfil a paid order, and refund a paid order. Fulfilment/refund must not be available for unpaid orders.
6. In Email setup & outbox, change planned sender/owner addresses, save, preview each email, simulate a successful send and a failed send, then retry failed messages.
7. In Shop rules, change the test delivery charge and maximum quantity. Confirm totals update. These are test values only.
8. Run the automated acceptance suite and export a JSON copy of test records.

## What it does not claim
This is an offline simulation. It does not contact Stripe, process a payment, send an email, persist data to a remote database, or reserve actual stock. It is for exercising the intended business flow and finding UX/logic gaps before real provider connections. The Cloudflare Worker package is separate and must be integration-tested in Stripe test mode before launch.
