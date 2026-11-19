Everything checks out: cumulative redemptions cap at payable (8000 + 2000 = 10000), excess points stay in the lot, and cancellation refunds fully. Final suite: **25/25 green**.

## Report

**What I changed**

*Domain (pure rules)*
- `src/loyalty/domain/points.ts` — added `planConsumption` (consume non-expired, non-empty lots, earliest expiry first, stable tie-break, capped at availability) and `refundableConsumption` (split a past debit into refundable vs forfeited-when-expired).
- `src/loyalty/domain/redemption.ts` *(new)* — `RedemptionRecord` (key, customer, order, points requested, cents applied, per-lot debits) and the idempotency rule `isSameRedemption`.
- `src/pricing/domain/quote.ts` — `quoteWithPoints` + `RedeemedQuote`: points reduce after discount, before tax, capped at the discounted subtotal, never below zero. Existing `quote`/`Quote` untouched so the GET-quote API is unchanged.
- `src/orders/domain/order.ts` — extracted `requirePending` (shared by cancel and redeem).

*Integration*
- `src/loyalty/integration/loyalty-store.ts` — added `transact(customerId, op)`: per-customer mutex serializing ledger reads/writes, so concurrent redemptions/cancellations can't double-spend (validated: disabling it fails the concurrency test).
- `src/loyalty/integration/redemption-store.ts` *(new)* — async redemption ledger keyed by (customer, idempotencyKey), scoped per customer.

*Application / routes*
- `src/loyalty/application/redeem-points.ts` *(new)* — `RedemptionService`: redeem inside a ledger transaction (replay same key+body → stored result, nothing consumed; same key+different body → 409 conflict; pending-owner checks; payable cap minus points already applied to the order), refund on cancellation (points back to original lots with original expiry; expired lots forfeited; idempotent via record removal).
- `src/orders/routes/order-routes.ts` — `POST /orders/:id/redeem` (auth-guarded, body validation → 400, outcome mapping: 200 quote / 404 / 409); cancel now runs inside the customer's ledger transaction and refunds redeemed points atomically.
- `src/app.ts` — composition root wires the new store + service (`redemptions` is an optional dep; signature preserved).

*Tests* — `tests/loyalty/redeem-points.acceptance.test.ts` (13 tests: tax/discount math, lot ordering, spillover, both caps, insufficient balance, replay, conflict, cross-customer key, validation, concurrency ×2, refund with original expiry, forfeit via time travel, plain cancel) and `tests/loyalty/points-consumption.test.ts` (3 domain tests).

**How I verified** — `npm test` 25/25 pass (9 pre-existing untouched); mutation check proving the mutex is load-bearing; ad-hoc scenario runs for sequential partial redemptions (cumulative cap 8000+2000=10000, refund restores the lot fully).

**Not done / assumptions** — Insufficient balance isn't specified: I consume whatever usable points exist (cap both ways, matching the "excess points are not consumed" philosophy) rather than rejecting. Replay of a key after cancellation returns 409 (the refund consumed the record, so it's a fresh attempt on a non-pending order). Multiple redemptions per order are supported and all are refunded on cancel. Success returns 200 with `{region, subtotalCents, discountCents, pointsCents, taxCents, totalCents}` (1 point = 1 cent, so `pointsCents` equals points applied). No `tsc` in the project (type stripping only), so typing was verified by runtime + Node's loader.