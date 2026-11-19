I've added `POST /orders/:id/redeem`. The full suite passes: the 9 existing tests plus 12 new acceptance tests.

**What I changed**
- **Spending points** (`src/loyalty/domain/points.ts`): picks which lots to spend from. It skips empty and expired lots, takes the one that expires first, and keeps the original order when two expire at the same time. It refuses if there aren't enough points. One point is worth one cent.
- **Records** (`src/loyalty/domain/redemption.ts`, `src/loyalty/integration/redemption-store.ts`): for each order, a record of how many points came from which lot. Idempotency keys are stored per customer along with the response they produced.
- **Concurrency** (`src/loyalty/application/keyed-lock.ts`, `ledger.ts`): one lock per customer, plus the logic to spend points and to give them back. The ledger store has no transactions or compare-and-set, so every read-then-write of a customer's lots runs under that customer's lock. Cancel uses the same lock.
- **Pricing** (`src/pricing/domain/quote.ts`): a new `quoteWithPoints` applies points after the discount and before tax, capped at the discounted amount. Only the points actually applied are spent.
- **Orders** (`src/orders/application/redeem-points.ts`): new redeem and cancel use cases. The order now stores `pointsApplied`, and points can only be applied once, to a pending order. Cancel gives points back to their original lots with the original expiry; if a lot has expired by then, those points are lost. `GET /orders/:id/quote` includes points once some have been redeemed.
- **Routes and wiring**: `order-routes.ts` has the new route, and cancel now goes through the new use case. `createApp` takes an optional `redemptions` store, so its signature is still compatible.

**Response codes:** 200 returns `{ region, subtotalCents, discountCents, pointsApplied, pointsCents, taxCents, totalCents }`. 400 is a bad body. 401 is not signed in. 404 is an order that doesn't exist or belongs to someone else. 409 is an order that isn't pending or already has points on it. 422 is not enough points, or a reused key with a different body.

**How I verified it**
- `tests/orders/redeem-points.acceptance.test.ts` covers:
  - spending order across lots, and that expired points can't be used
  - discount, then points, then tax, with rounding
  - the amount never going below zero, and excess points staying in their lots
  - repeating a key, and reusing a key with a different body
  - three simultaneous requests with the same key
  - two simultaneous redemptions that together ask for more than the customer has
  - a redeem and a cancel arriving at the same time
  - cancel giving points back with the original expiry, and points lost when the lot expires exactly at cancel time
  - auth, ownership and order-status checks, and body validation
- I turned the lock off temporarily: the two concurrency tests failed, then passed again once I put it back.

**Decisions you may want to change**
- **One redemption per order:** a second one with a new key gets 409; I chose that over adding the points together.
- **Not enough points:** the request gets 422 rather than spending whatever is available.
- **Idempotency scope:** keys are per customer. Only successful results are saved, so retrying a failed request with the same key runs it again. A successful key still returns its saved result after the order is cancelled.
- **Response fields:** the quote has both `pointsApplied` and `pointsCents`. The quote for an order without points keeps its old shape, so the response shape varies.

**Limits**
- **Single process only:** the lock lives in memory, so running several instances would need a database-level guard such as a transaction or compare-and-set.
- **Partial failures:** if storage fails partway through spending, lots already written are put back on a best-effort basis. Cancel records each lot as it's handled, so a retry doesn't give points back twice. There's no real atomicity, and these failure paths are 