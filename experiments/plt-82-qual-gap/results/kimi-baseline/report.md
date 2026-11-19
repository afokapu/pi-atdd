All 21 tests pass (13 new LOY-002 tests + all 8 pre-existing ones). 

## Report

**What I changed**

- `src/pricing/domain/quote.ts` — `quote()` now takes an optional `pointsAppliedCents`: points come off after the discount, tax is computed on the remainder, and the applied amount is capped so the total never goes below zero. `Quote` gained an optional `pointsAppliedCents` field (only present when > 0, so existing quotes/tests are unchanged).
- `src/pricing/application/quote-service.ts` — `quoteForOrder` sums the order's redemptions and includes them in the quote (so `GET /orders/:id/quote` reflects redeemed points).
- `src/loyalty/domain/points.ts` — added `allocateLots()`: consumes non-expired lots with balance, earliest expiry first (FEFO), never more than needed.
- `src/orders/domain/order.ts` — `Order` gained optional `redemptions` (idempotency key, points, per-lot `consumed` records with original expiry) plus `appliedPoints()`; `order-store.ts` deep-copies them.
- `src/loyalty/application/redeem-service.ts` (new) — `RedeemService` use case: idempotency records keyed per customer (same key replays the stored response without consuming; same key + different body/points/order → 409), a per-customer promise-chain mutex so concurrent redemptions against the async ledger can never double-spend, and `restoreForOrder()` for cancellation, which returns points to their original lots (expiry untouched) and forfeits those whose lot has since expired.
- `src/orders/routes/order-routes.ts` — new `POST /orders/:id/redeem` (owner-only 404, pending-only 409, body validation 400, returns the new quote); `POST /orders/:id/cancel` is now async and restores points after cancelling.
- `src/app.ts` — wires a `RedeemService` into the routes; `createApp` signature unchanged (uses existing `loyalty`/`now` deps).
- `tests/loyalty/redeem.acceptance.test.ts` (new) — 13 acceptance tests: FEFO consumption with expired-lot skipping, quote math (points after discount, before tax), idempotent replay, key-reuse rejection, excess-points capping, partial application when balance is short, concurrency (two simultaneous redeems split 800 available points as 600/200), restore-on-cancel, forfeit-on-expired-lot (via an advanced clock), and quote endpoint reflection.

**Verification:** `npm test` — 21/21 pass, including all pre-existing tests.

**Decisions/uncertainties**

- 100 points = €1 ⇒ 1 point = 1 cent, so "points applied" in cents equals points consumed.
- If the customer requests more points than their balance, I apply what's available (partial) rather than erroring — the applied amount is visible in the response.
- If a lot somehow vanished between allocation and deduction, the redemption fails with 409 (can't happen with the in-memory store since all flows are mutex-serialized).
- Multiple redemptions per order with different keys are allowed, capped at the discounted subtotal; replaying a key after cancellation returns the stored result.