All 29 tests pass (9 pre-existing + 20 new). 

## Report

### What I changed

**New files (loyalty context):**
- `src/loyalty/domain/redeem.ts` — `planConsumption`: picks non-expired lots, earliest expiry first (ties in insertion order), never overdraws.
- `src/loyalty/domain/redemption.ts` — `Redemption` record: requested/applied points, resulting quote, per-lot consumption, `restoredAt` marker.
- `src/loyalty/integration/redemption-store.ts` — async store with idempotency-key and per-order indexes.
- `src/loyalty/application/redeem-service.ts` — `RedeemService`: all ledger read-modify-writes for a customer run on a **per-customer promise queue**, so concurrent redemptions can't spend the same points despite async stores. Handles idempotency (same key + same body → stored quote, nothing consumed; different body → `IdempotencyConflictError` → 409), caps points at the discounted amount minus already-applied points, and `releaseForOrder` (cancel) which returns points to their original lots, forfeiting lots that expired by then, exactly once.

**Modified:**
- `src/pricing/domain/quote.ts` — `quoteWithPoints`: points reduce the amount **after discount, before tax**, never below zero (1 point = 1 cent, 100 pts = €1).
- `src/pricing/application/quote-service.ts` — `quoteForCartWithPoints`.
- `src/orders/domain/order.ts` — extracted `requirePending` (reused by `cancel`); redeem route uses it for the 409.
- `src/orders/routes/order-routes.ts` — `POST /orders/:id/redeem` (404 other's/unknown order, 400 invalid body, 409 non-pending/key conflict, 200 + quote `{region, subtotalCents, discountCents, pointsCents, taxCents, totalCents}`); cancel now releases redeemed points.
- `src/app.ts` — wires `RedeemService`; new optional `redemptions` dep (signature kept compatible).

### How I verified
- `npm test`: 29/29 pass (all pre-existing tests unchanged and green).
- 20 new tests: pricing math (SAVE10 + points + tax), lot ordering across/across-expired lots, amount/availability caps, idempotent replay & conflict, auth/ownership/status/validation errors, concurrency (2-way, 3-way, duplicate key racing), cancel restore, expiry forfeit, double-cancel.
- **Mutation check**: bypassing the mutex makes the concurrency tests fail (double-spend detected); restored → green.
- **Stress script**: 20 concurrent 90-point redemptions on 1000 points consumed exactly 1000, no negative lots, replay stable.

### Notes / not done
- `pointsCents` in the quote is the **cumulative** points applied to the order (identical to per-redemption for the single-redemption case); multiple partial redemptions per order with distinct keys are allowed and accumulate.
- Replay after cancel returns 409 (pending check runs first), not the stored quote.
- `GET /orders/:id/quote` intentionally still returns a points-free quote (existing behavior preserved).
- Concurrent same-customer redeem+cancel has a benign race: a redeem validated just before the cancel saves consumes, then the queued release returns those points — end state stays consistent.