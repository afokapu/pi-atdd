`POST /orders/:id/redeem` is implemented and the full suite passes (20 tests, 11 of them new). I did not run a TypeScript type check because no `tsc` is installed in this environment.

**What changed**
- `src/loyalty/domain/points.ts`: `usablePoints`, `allocatePoints` (non-expired lots, earliest expiry first), and 1 point = 1 cent.
- `src/loyalty/domain/redemption.ts` (new): the redemption ledger record.
- `src/loyalty/integration/loyalty-store.ts`: redemption lookup by key and by order, plus save.
- `src/pricing/domain/quote.ts`: `quoteWithPoints`. Points come off after discount, never exceed the payable amount, and are taxed on what remains. The existing `quote()` is unchanged, since its output is asserted exactly.
- `src/orders/application/order-use-cases.ts` (new): `redeemPoints` and `cancelOrder`.
- `src/orders/application/customer-lock.ts` (new): per-customer serialisation.
- `src/orders/routes/order-routes.ts`, `src/app.ts`: the new route, and cancel now goes through the use case.
- `tests/orders/redeem-points.acceptance.test.ts` (new).

**Behaviour**
- Response is the quote in cents: `region, subtotalCents, discountCents, pointsAppliedCents, taxCents, totalCents`.
- Same key with the same body returns the stored quote and consumes nothing more. Same key with a different body returns 422.
- Cancelling returns points to their original lots with the original expiry. Points whose lot has expired by cancel time are forfeited.
- Concurrency: redeem and cancel for a customer run one at a time. I confirmed the concurrency test fails when the lock is disabled.

**Decisions you may want to change**
- Requesting more points than the balance or the payable amount is not an error; the excess is simply not applied.
- An order can carry only one live redemption. A second key on the same order returns 409.
- A replayed key still returns the original 200 after the order is cancelled.
- Errors: 404 for unknown or foreign orders, 409 for non-pending orders, 400 for a bad body, 401 when unauthenticated.

**Not done / unsure**
- Consistency is in-process only. The lock and the lot writes are not transactional, so a crash between lot writes and the ledger write could lose or double-count points. Real persistence would need a database transaction or a conditional write.
- The lock does not protect across multiple service instances.
- Redemption does not change the order's status; the order stays `pending`.
- I did not add a GET endpoint for redemption records.