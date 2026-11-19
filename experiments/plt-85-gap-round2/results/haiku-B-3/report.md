LOY-002 is implemented: `POST /orders/:id/redeem` works, and cancelling a redeemed order returns the points. All 22 tests pass (9 existing plus 13 new).

**What changed**
- `src/loyalty/domain/points.ts`: points-to-cents conversion (1 point = 1 cent), usable lots filtered and sorted by expiry, `spendPoints` (earliest expiry first) and `returnPoints` (forfeits lots that have expired).
- `src/pricing/domain/quote.ts` and `quote-service.ts`: `quoteWithPoints` applies points after discount and before tax, capped so the taxable amount never goes below zero. The existing `quote()` is unchanged, so the GET quote response is unchanged.
- `src/loyalty/integration/loyalty-store.ts`: redemption records (idempotency key, request fingerprint, allocations, stored quote, status), with async lookup by key and by order.
- `src/loyalty/application/ledger-lock.ts`: per-customer queue. `redemption-service.ts` holds `redeemPoints` (idempotent replay, pending-only, one active redemption per order) and `reverseRedemption`.
- `src/orders/routes/order-routes.ts`: new redeem route. Cancel and redeem both run under the customer lock. Cancel reverses the redemption before saving the order as cancelled.
- `src/app.ts`: passes the loyalty store and clock through `createApp`. The signature is unchanged.
- `tests/loyalty/redeem-points.acceptance.test.ts`: covers each requirement, plus a concurrency test.

**How I verified it**
- `npm test`: 22 pass, 0 fail.
- I ran two concurrent redemptions for 800 points each against an 800-point lot without the lock, and both were applied. The concurrency test therefore fails without the lock.
- Comment ratio on the touched files is at or above 10%, checked with a rough line count. I did not run the project's `bun_*` detectors, and there is no `tsc` in the repo, so type checking was not run.

**Decisions I made that you may want to change**
- Only one active redemption per order. A second one with a different key returns 409 `ORDER_ALREADY_REDEEMED`.
- Idempotency keys are scoped per customer. Reusing a key for another order counts as a different body and returns 409 `IDEMPOTENCY_KEY_REUSED`.
- A replayed key returns the stored quote even if the order has since been cancelled.
- Error bodies use `error_code` in UPPER_SNAKE_CASE, in line with the project's error conventions.

**Not done or uncertain**
- The lock is in-process only. Several instances would need a database-level guarantee, such as a conditional update on the lot.
- The writes to several lots are not atomic. A failure part-way through would leave partial state, which is acceptable for the in-memory store but not for a real ledger.
- Pre-existing files I did not touch (e.g. `router.ts`, `auth.ts`) may still be below the 10% comment floor.
- The seed data is unchanged, so there is no demo redemption path beyond the tests.