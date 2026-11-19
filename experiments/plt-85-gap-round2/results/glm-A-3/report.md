Everything works end-to-end with the seed data (bob's FR order: 5000−500 FLAT5=4500 taxable, 250pts → 850 tax; alice's o1 with all 800 spendable points: 4543−800=3743 → 711 tax; cancel restores points). Final suite: **28/28 green**.

## Report

### What I changed

**New files**
- `src/loyalty/domain/redeem.ts` — pure planning: `availablePoints`, `planConsumption` (non-expired lots, earliest expiry first, ties by insertion order), `planRefund` (refund to original lots; expired/missing lots forfeited).
- `src/orders/application/redeem-service.ts` — `RedeemService`: per-customer mutex (`runExclusive`, promise-chain), in-memory idempotency ledger (records kept per customer+key, only on success), `redeem()` and `refundRedemption()` running against the async loyalty store.
- `tests/orders/redeem-order.acceptance.test.ts` (14 tests), `tests/loyalty/redeem.test.ts` (5 unit tests).

**Modified**
- `src/loyalty/domain/points.ts` — `pointsToCents` (100 pts = €1 ⇒ 1 pt = 1 cent, documented once).
- `src/pricing/domain/quote.ts` — `quoteWithPoints`: points reduce after discount, before tax, capped at the discounted amount (`QuoteWithPoints = Quote & { pointsCents }`).
- `src/pricing/application/quote-service.ts` — `quoteForCartWithPoints`.
- `src/orders/domain/order.ts` — `Redemption { points, lots[] }` bookkeeping on the order; `applyRedemption` (pending-only, merges across multiple redemptions).
- `src/orders/routes/order-routes.ts` — `POST /orders/:id/redeem` (401/400/404/409 mapping, 200 + new quote); cancel now runs its whole read-modify-write under the customer lock and refunds the order's points via the service.
- `src/orders/integration/order-store.ts` — deep-copies the nested redemption record.
- `src/app.ts` — wires `RedeemService` (signature unchanged, `now` threaded through).

### How I verified
- Full suite `npm test`: 28/28 pass (9 pre-existing stay green), stable over repeated runs.
- Mutation check: removing the per-customer lock makes the concurrency test fail with a real double-spend, so the test genuinely covers the race. Concurrent same-key replays and concurrent redeem-vs-cancel are also covered (invariants: nothing consumed twice, no points lost, order ends cancelled).
- End-to-end smoke over seed data (bob/o3, alice/o1 redeem + cancel).

### Assumptions / not done
- **Insufficient balance is not an error**: applied = min(requested, available, discounted − already applied); a short balance applies what exists (`pointsCents` shows it). Spec only mentions capping excess, so I extended the "cap, don't reject" rule; a 4xx for insufficient balance would be a one-line change.
- **Idempotency conflict → 409** (same key, different `points` or different order). Keys are scoped per customer; failures aren't recorded so retries with the same key are allowed.
- Second redeem with a new key returns the order's quote with **total** accumulated points (so subtotal−discount−points+tax stays consistent).
- `GET /orders/:id/quote` is unchanged (existing exact-shape test; it doesn't reflect points — only the redeem response does). Redeem leaves the order `pending`.
- Concurrency safety is per-process (in-memory store); real cross-instance locking would belong in the DB adapter.
- No `tsc` in the repo (type-stripping project), so no static typecheck — verified by execution only.