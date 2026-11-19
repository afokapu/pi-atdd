Done. **LOY-002 implemented — `POST /orders/:id/redeem`.**

## What changed

**New files**
- `src/orders/application/redeem-service.ts` — the use case: loads order (owner + pending checks), computes the quote with pricing-domain primitives, plans lot consumption, persists, records the redemption ledger entry, and refunds on cancel. All state transitions run under a per-customer lock.
- `src/orders/application/customer-lock.ts` — in-process promise-chain mutex per customer, serializing redeem/cancel-refund read-modify-write cycles so concurrent redemptions can't double-spend lots.
- `tests/orders/redeem-order.acceptance.test.ts`, `tests/loyalty/points-plan.test.ts` — 19 new tests.

**Modified**
- `src/loyalty/domain/points.ts` — pure additions: `pointsToCents`/`centsToPoints` (100 pts = €1), `usableLots`, `planRedemption` (earliest-expiry-first, skips expired, capped by balance), `ConsumedLot`, `isExpiredAt`.
- `src/loyalty/integration/loyalty-store.ts` — async `Redemption` ledger: `saveRedemption`, `findRedemption(customer, key)`, `redemptionsForOrder` (keyed per customer+idempotencyKey; stores per-lot `taken` with original expiry).
- `src/orders/routes/order-routes.ts` — new redeem route (400 invalid body, 404 not owner/found, 409 non-pending or key conflict, 200 = new quote); cancel now refunds inside the same lock.
- `src/app.ts` — wires `RedeemService` (`now` injectable, default system clock). `createApp` signature unchanged.

**Semantics**: points subtract after discount, before tax, integer cents, never below zero, excess not consumed (`min(request, payableCents, balance)`); same key + same body → replayed result, nothing re-consumed; same key + different body/order → 409; cancel restores points to original lots with original expiry, forfeiting points of lots expired at cancel time. Response: `{ region, subtotalCents, discountCents, pointsApplied, pointsCents, taxCents, totalCents }` (`pointsApplied` = points; `pointsCents` = its cent value — numerically equal at 100 pts/€1, both included since the spec says "points applied" among cent amounts).

## Verification
- All 28 tests pass (9 pre-existing untouched + 19 new), covering: discount→points→tax math, expired-lot skipping, earliest-first multi-lot consumption, amount/balance clamping, zero-payable, idempotent replay, key conflict, owner/401/404/409 handling, validation, cancel refund restoring lots + expiry, forfeit-on-expired-cancel, and concurrent redemptions via `Promise.all`.
- Extra stress script: 10 parallel redemptions across 2 orders consumed exactly the 350-point balance, lots emptied once.

## Notes / not done
- Locks are per-process; a real multi-instance deployment would need DB-level transactions/row locks — out of scope for this in-memory store.
- `GET /orders/:id/quote` still returns the pre-points quote (spec only asks the redeem response to carry the new quote); no stored "paid" field on the order — refund state lives in the redemption ledger.
- Replaying a redeem key after the order was cancelled returns the stored quote (order lines are immutable while pending), rather than 409.