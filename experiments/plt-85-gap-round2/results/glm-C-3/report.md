All green — 25/25 tests pass. The work is complete.

## Report

### What I changed

**New files**
- `src/loyalty/domain/redemption.ts` — `Redemption` ledger record: request fingerprint, captured `allocations` ({lotId, points}[]), stored original response, `held|reversed` status.
- `src/loyalty/integration/redemption-store.ts` — async store; records keyed per `(customerId, idempotencyKey)` (no cross-tenant key leaks), insert-if-absent `claim`, indexed by `orderId` (no ledger scans).
- `src/loyalty/application/owner-locks.ts` — per-customer async mutex (the row-lock substitute for the async stores).
- `src/loyalty/application/redeem-points.ts` — redeem use case: authorise → replay-or-reject by fingerprint → state check → cap points at remaining payable → consume lots → claim key — all inside one per-customer critical section.
- `src/loyalty/application/release-points.ts` — reversal: restores recorded allocations to their original lots (original expiry untouched), forfeits points of lots expired at reversal time, applies each record once (status flip inside the section).
- `src/orders/application/cancel-order.ts` — cancel + release under the same customer lock (cancel can't interleave with redeem).
- `tests/loyalty/redeem-points.acceptance.test.ts`, `tests/loyalty/redeem-cancel.acceptance.test.ts` — 16 acceptance tests.

**Modified**
- `src/pricing/domain/quote.ts` — `quoteWithPoints`: adjustment order subtotal → discount → points (1 point = 1 cent) → `Math.round(taxable·rate)` once; clamped so total never goes below zero, excess points not consumed. `quote` is now a thin wrapper (no duplication).
- `src/pricing/application/quote-service.ts` — `quoteForOrderWithPoints`.
- `src/loyalty/domain/points.ts` — `planConsumption` (non-expired lots, earliest expiry first) and `planReversal`, both pure.
- `src/orders/routes/order-routes.ts` — new `POST /orders/:id/redeem` (auth guard, body validation → 400, replay 200 / payload-mismatch 409 / non-pending 409 / not-owner 404); cancel route delegates to the use case.
- `src/app.ts` — composition root wires `OwnerLocks`, redemption store, and `now`; README updated.

### How I verified
`npm test`: 25 pass (9 pre-existing untouched + 16 new) covering quote math (e.g. 10000 subtotal, SAVE10, 400 pts → `{10000, 1000, 400, 1634, 10234}`), earliest-expiry-first spill, expired-lot skip, excess-not-consumed, cap-at-payable, replay verbatim, same-key-different-body 409 with no extra consumption, per-customer key scoping, auth/ownership/state, invalid bodies, `Promise.all` concurrency (applied [300,300,200], lots exactly drained), cancel restore with original ids+expiry, forfeit on expired lots, double-cancel, and replay-after-cancel. Also interactively verified cumulative partial redemptions (100 → 50 → 0 applied, lot drained to exactly 0).

### Not done / unsure
- A **second redemption with a different key** on the same order is *allowed* (cumulative, capped at remaining payable) — the task doesn't specify; `pointsAppliedCents` is per-redemption while tax/total reflect the whole order (documented in code).
- **Replay after cancellation** returns the stored 200 verbatim (chosen per idempotency semantics; pinned by a test).
- "Same transaction as the side effect" is approximated by the per-customer critical section plus insert-if-absent claim, since the in-memory stores have no real transactions.