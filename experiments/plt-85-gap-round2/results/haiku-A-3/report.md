Added `POST /orders/:id/redeem` (LOY-002) and updated cancel to return points. All 27 tests pass, including 18 new ones in `tests/orders/redeem-points.acceptance.test.ts`.

**What changed**
- `src/loyalty/domain/points.ts`: unit conversion (1 point = 1 cent), spendable balance, and `allocatePoints`, which takes non-expired lots earliest-expiry first.
- `src/loyalty/domain/redemption.ts` (new): the redemption record, with allocations, a request fingerprint and a stored quote.
- `src/loyalty/integration/loyalty-store.ts`: stores redemption records, looked up by key and by order.
- `src/loyalty/application/customer-lock.ts` (new): a per-customer async lock.
- `src/pricing/domain/quote.ts` and `src/pricing/application/quote-service.ts`: `quoteWithPoints`. It applies points after discount and before tax, capped at the discounted amount. The existing `Quote` type is unchanged.
- `src/orders/application/order-payment.ts` (new): the redeem use case and the reversal logic for cancel.
- `src/orders/routes/order-routes.ts`: the new route, and cancel now runs under the lock and returns points.
- `src/app.ts`: passes `loyalty` and `now` to the order routes. `createApp`'s signature is unchanged.

**How it was verified**
- `npm test`: 27 of 27 pass.
- Disabling the customer lock makes both concurrency tests fail, so they exercise the lock.
- Tests cover: the amount after discount and before tax; earliest-expiry consumption; excess points not consumed; no negative amounts; idempotent replay; a key reused with a different body; concurrent same-key requests; concurrent redemptions competing for the same points; cancel restoring original lots and expiry; forfeiture of expired lots; and the 401, 400, 404 and 409 paths.

**Decisions to review**
- Requesting more points than the customer's spendable balance returns 409. Points beyond the payable amount are simply not consumed.
- An order can be redeemed only once. A second redemption with a different key returns 409.
- An idempotency key mismatch returns 409, not 422.
- Idempotency keys are scoped per customer. A replay returns the stored quote, even after the order is cancelled.

**Not done or uncertain**
- Not type-checked. There is no `tsc` in the repo and I did not install one. Tests run through Node type stripping only.
- The concurrency guarantee is in-process. Two service instances, or a crash between lot writes and the redemption record write, could still leave inconsistent state. A real database would need a transaction or conditional updates.
- Cancel does not check whether a redeemed lot was deleted. The store never deletes lots, so I did not handle that case.