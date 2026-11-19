`POST /orders/:id/redeem` is in place, and cancel now returns points. All 21 tests pass: the 9 existing ones and 12 new LOY-002 acceptance tests. Nothing is committed.

**What changed**
- `src/loyalty/domain/points.ts`: pure rules for spending lots earliest-expiry-first, computing the spendable balance, and returning points to a lot (forfeited if that lot has expired). Also the `Redemption` record.
- `src/loyalty/integration/loyalty-store.ts`: stores redemption records per order.
- `src/loyalty/application/customer-lock.ts`: a per-customer lock that serialises redeem and cancel for one customer.
- `src/pricing/domain/quote.ts` and `application/quote-service.ts`: `quoteWithPoints`, which applies points after discount and before tax, capped at the amount due. The existing `quote()` is unchanged.
- `src/orders/application/order-payments.ts`: the redeem and cancel use cases.
- `src/orders/routes/redeem-route.ts`, `order-errors.ts`, `order-routes.ts`, `src/app.ts`: the endpoint, error mapping, and wiring. `createApp`'s signature is unchanged.
- `tests/loyalty/redeem-points.acceptance.test.ts`: the new tests.

**How I verified it**
- `npm test`: 21/21 passing.
- With the lock bypassed, the concurrency test fails (both redemptions succeed). With the lock restored it passes.
- Every touched function is under the 50-line limit.

**Decisions to check**
- **Points value:** 1 point = 1 cent, so `pointsAppliedCents` equals points consumed.
- **Over-request:** asking for more points than the customer holds returns 409 `INSUFFICIENT_POINTS`. Asking for more than the amount due is capped, and only the capped amount is consumed.
- **One redemption per order:** a different key on an order that already has a redemption returns 409 `ORDER_ALREADY_REDEEMED`. Same key with different points returns 422 `IDEMPOTENCY_KEY_REUSED`.
- **Replay after cancel:** a retry with the original key still returns the stored quote after the order is cancelled. It spends nothing, but the response may look odd.
- **Replay tax:** the replayed quote is recomputed from the stored allocation, so it would differ if tax rates changed in between.
- **Error bodies:** redeem and cancel errors now carry `error_code`. The cancel 404/409 bodies gained that field.

**Not done / unsure**
- The lock only works within one process. Several instances would need a store with transactions or conditional writes.
- No type-check ran: `tsc` isn't installed, and tests run through Node's type stripping. Please run a type-check before merging.
- No README update for the new endpoint.