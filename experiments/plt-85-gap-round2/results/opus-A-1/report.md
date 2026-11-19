I added `POST /orders/:id/redeem`. The full suite passes: 23 tests, the 9 existing ones plus 14 new ones. Points can only be redeemed once per order, and the response field names and error codes are my own choices. Those are the things to check against what clients expect.

**Changes**
- **Points rules** (`src/loyalty/domain/points.ts`): the code takes points from lots that haven't expired, earliest expiry first. It caps the points used at the amount left after the discount, so the order never goes below zero and extra points stay in the customer's lots. A lot can't be used at its exact expiry instant, matching the existing `isExpired` rule.
- **Pricing** (`src/pricing/domain/quote.ts`, `src/pricing/application/quote-service.ts`): the order is now priced as subtotal, then discount, then points, then tax on what remains, all in integer cents. `GET /orders/:id/quote` shows the points on a redeemed order.
- **Order record** (`src/orders/domain/order.ts`, `src/orders/integration/order-store.ts`): an order now records its redemption, including which lots the points came from. The store now makes full copies so that record can't be changed by accident.
- **Concurrency** (`src/loyalty/application/customer-lock.ts`): one customer's redemptions and cancellations run one at a time. The duplicate-request check happens inside that lock.
- **Partial failures** (`src/loyalty/application/ledger.ts`): if a write to the points store fails partway, the lots already changed are put back. This is best effort.
- **Redeem logic** (`src/loyalty/application/redeem-points.ts`): repeating a request with the same key returns the stored result and uses no more points. Reusing a key with a different body (different order or points) is rejected.
- **Cancel** (`src/orders/application/cancel-order.ts`, now async): returns points to their original lots with the original expiry. Points whose lot has expired by then are forfeited. The order records how many points were returned and how many were forfeited.
- **Wiring** (`src/app.ts`, `src/loyalty/routes/redeem-routes.ts`): the new route is registered and `createApp` keeps its signature. It has one new optional input, `idempotency`, for the store of earlier results.

**Response and errors**
- Success returns `{ region, subtotalCents, discountCents, pointsAppliedCents, taxCents, totalCents }`.
- The `pointsAppliedCents` field only appears once points have been redeemed. That keeps the existing quote test's exact match passing.
- 400: invalid body. 401: not signed in. 404: missing order or someone else's. 409: order not pending, or points already redeemed on it. 422: not enough points, or a key reused with a different body.

**Verification**
`tests/loyalty/redeem-points.acceptance.test.ts` covers:
- order of lot use and expired lots
- points after discount and before tax
- the zero floor and leftover points
- not enough points (nothing is used)
- same-key replay, including several at once
- key reuse with a different body
- two redemptions at once that would overspend
- cancel returning points, with an expired lot forfeited
- two cancellations at once
- ownership, order status and bad input

With the lock turned off, the two concurrency tests fail, so they really do test the lock.

**Not done / unsure**
- **One redemption per order**: a second redemption with a new key gets 409; adding to the first one isn't supported.
- **Field names and status codes**: `pointsAppliedCents`, and 422 vs 409, are guesses. There was no API contract to check them against.
- **Single process only**: the lock and the stored results live in memory. Running several instances would need locking or conditional writes in the real points database. Stored results never expire, and only successful redemptions are stored, so a failed request with the same key is re-evaluated.
- **Cancelling an order with no redemption**: it still goes through the lock and is now async.
- **Not recoverable after a crash**: the points-store writes and the order s