`POST /orders/:id/redeem` is in place and the suite passes (22 tests: the 9 existing plus 13 new).

**What changed**
- `src/loyalty/domain/points.ts`: 1 point = 1 cent. Added the lot allocator (earliest expiry first, skipping expired lots), applied-points cap (`min(requested, usable, payable)`), and pure spend/restore helpers. Restore returns points to the original lot only if it hasn't expired by cancellation time.
- `src/loyalty/domain/redemption.ts` (new): the redemption record, quote type, and conflict error.
- `src/loyalty/integration/loyalty-store.ts`: redemption records and an atomic `commit` (validate everything, then write).
- `src/pricing/domain/quote.ts`: `quoteWithPoints` (discount → points → tax). The existing `quote()` is unchanged.
- `src/loyalty/application/customer-lock.ts` (new): per-customer async lock.
- `src/orders/application/points-payment.ts` (new): `redeemOrder` and `releaseRedemption`.
- `src/orders/routes/order-routes.ts`: new redeem route; cancel now runs under the lock and returns points.
- `src/app.ts`: passes `loyalty` and `now` to the order routes. `createApp` signature is unchanged.
- `tests/orders/redeem-order.acceptance.test.ts` (new).

**Verification**
- `npm test`: 22/22 pass.
- I disabled the customer lock and the concurrency test failed (two orders for Alice each asked for 500 of her 800 points, and both got 500 applied). I restored the lock and confirmed it passes again.

**Decisions to review**
- Each order takes at most one points redemption. A second request with a different key returns 409.
- `points` must be a positive integer. If no usable points can be applied (none held, or the payable amount is 0), the request returns 409 and nothing is recorded.
- Idempotency is scoped per customer. The fingerprint is the order id plus points, so reusing a key on a different order also returns 409. Conflicts use 409.
- Successful results are stored and replayed verbatim, so a replay after a tax-rate change still returns the original quote.

**Not done or unsure**
- The lock is in-process only. With multiple instances, the ledger needs a real transaction or row lock.
- The store's atomic commit is in-memory only, and idempotency records are kept indefinitely.
- `GET /orders/:id/quote` does not reflect a redemption, since the spec didn't ask for that.
- There is no type-checker in the repo and no `node_modules`, so I did not run `tsc`. Tests run via Node's type stripping only.
- I did not commit. The changes are in the working tree.