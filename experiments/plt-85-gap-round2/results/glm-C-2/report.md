Everything is green and the mutation was fully reverted. Done.

## Report — LOY-002: Pay with loyalty points

### What I changed

**New files**
- `src/loyalty/integration/redemption-store.ts` — async `InMemoryRedemptionStore`: the redemption ledger storing per record the `(customerId:orderId)` scope, idempotency key, payload fingerprint, consumed-lot **allocations**, stored original response, and a `reversed` flag. `recordIfAbsent` plays the unique-constraint role that claims a key; an order-id index avoids scans on cancel.
- `src/orders/application/per-key-lock.ts` — `PerKeyLock`: promise-chained per-customer mutex so read–decide–write against the async ledger can't interleave for one customer (different customers run concurrently).
- `src/orders/application/redeem-points.ts` — `redeemForOrder` use case: re-checks ownership/pending inside the lock, replays the stored result on same key+payload, rejects a different payload under a used key (`IDEMPOTENCY_CONFLICT`), caps points to the discounted amount (`applicablePoints` — excess never consumed), draws lots earliest-expiry-first, quotes the new amount, claims the record in the same critical section. `INSUFFICIENT_POINTS` when spendable balance is short.
- `src/orders/application/cancel-order.ts` — `cancelOrder` use case: same lock; reverses every unreversed redemption of the order **exactly once** by restoring the recorded allocations to their original lots (original expiry intact); expired-by-reversal-time lots are forfeited, never re-issued fresh.
- Tests: `tests/loyalty/points.test.ts`, `tests/loyalty/redeem.acceptance.test.ts`, `tests/orders/cancel-redeemed.acceptance.test.ts`.

**Modified**
- `src/loyalty/domain/points.ts` — `Allocation`, `CENTS_PER_POINT`, `applicablePoints`, `spendableLots/Points`, `planConsumption` (earliest expiry first, id tie-break), `planRestoration` (restore vs forfeit).
- `src/pricing/domain/quote.ts` + `quote-service.ts` — `quoteWithPoints`/`quoteForOrderWithPoints`: documented order subtotal → discount → points → tax (once, on the reduced base), never below zero; existing `Quote` untouched.
- `src/orders/domain/order.ts` — added `OrderNotFoundError`.
- `src/orders/routes/order-routes.ts` — `POST /orders/:id/redeem` (body validated, structured `error_code` responses); cancel now goes through the use case (same 200/404/409 mapping).
- `src/app.ts` — optional `redemptions`/`locks` deps, default-constructed in the composition root; `createApp` signature preserved.

### How I verified
- Full suite: **32/32 pass** (9 pre-existing untouched, 23 new). Covers: quote math (incl. discount-then-points, half-up tax rounding, total 0 at cap), earliest-expiry-first + expired lots untouched, excess not consumed, replay idempotency, key-mismatch rejection, insufficient balance, pending-only/404/401/400 paths, concurrent redemptions (no lost update, no overspend), cancel restoring to original lot+expiry, forfeit after expiry, racing cancels reversing once, multi-redemption cancel.
- **Mutation check**: removing the per-customer lock makes exactly the three concurrency tests fail — proving they detect lost updates/overspend.

### Not done / notes
- **Insufficient balance → 409 `INSUFFICIENT_POINTS`** was not specified (only "excess over the amount is not consumed"); I chose rejection over partial consumption — easy to change if the intended contract differs.
- Redeeming with `points` greater than 0 but a fully-discounted order applies 0 points and records a zero-value redemption (idempotent, harmless).
- A replay after the order was cancelled returns 409 (state check runs before replay) rather than the stale stored response — deliberate.
- No real DB/transactions: consumption and record-write are two store calls, but both happen inside the customer's critical section; in the real ledger they'd share one transaction.