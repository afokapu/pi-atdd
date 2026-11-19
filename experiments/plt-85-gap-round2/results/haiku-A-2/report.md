The redeem and cancel changes are in, and all 19 tests pass (9 existing, 10 new).

**What changed**

- `src/loyalty/domain/points.ts`: `allocatePoints` takes non-expired lots, earliest expiry first (ties by id), and never plans more than requested or available. One point is one cent.
- `src/pricing/domain/quote.ts`, `quote-service.ts`: `quote()` takes optional `pointsCents`. Tax is computed on discounted subtotal minus points, and points are rejected above the payable amount.
- `src/loyalty/integration/loyalty-store.ts`: records which lots paid for each order, and stores idempotency responses per customer and key.
- `src/orders/application/loyalty-payment.ts` (new): `redeemPoints` and `cancelOrder`. Both run under a per-customer lock. Cancel restores points only to lots that have not expired by the cancel time.
- `src/orders/application/keyed-mutex.ts` (new): the per-customer lock.
- `src/orders/domain/order.ts`: `assertPending` added.
- `src/orders/routes/order-routes.ts`, `src/app.ts`: `POST /orders/:id/redeem` added. Cancel now delegates to `cancelOrder`. `createApp` keeps its signature.
- `tests/loyalty/redeem-points.acceptance.test.ts` (new): 10 tests.

**Verification**

- `npm test`: 19 pass, 0 fail.
- The worked example (seeded `o1`, 600 points) gives subtotal 5048, discount 505, points 600, tax 749, total 4692. The expired lot is skipped.
- To confirm the concurrency test is meaningful, I disabled the lock and it failed. I then restored the lock and re-ran the suite.

**Not done or uncertain**

- Response shape: the redeem response is the quote plus `pointsAppliedCents`. I left `Quote` and `GET /orders/:id/quote` unchanged so the existing deepEqual test still passes. As a result, `GET .../quote` does not show points after a redemption. That should probably be fixed.
- Multiple redemptions on one pending order accumulate, with the cap applied to the remaining payable amount. The spec didn't say whether a second redemption should be allowed; say if you want it rejected.
- Only successful redemptions are stored under an idempotency key. Errors are not recorded, so a failed request can be retried with the same key.
- The lock is in-process. It does not protect against multiple service instances sharing one ledger.
- Lot writes are separate `saveLot` calls, not one atomic commit. A crash mid-write could leave lots partly updated.
- No TypeScript type-check was run; there is no `tsc` or `node_modules` in the repo. Node's type stripping ran the code, so syntax and runtime behaviour are checked, not types.