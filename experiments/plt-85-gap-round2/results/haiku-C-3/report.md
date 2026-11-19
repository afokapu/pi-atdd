LOY-002 is implemented. The full suite passes (24 tests, 15 new), and I did not commit anything.

**What changed**

- **Redeem route:** `POST /orders/:id/redeem` in `src/orders/routes/order-routes.ts`. Body `{ points, idempotencyKey }` (points a positive integer, key a non-empty string). Returns 200 with `{ region, subtotalCents, discountCents, pointsCents, taxCents, totalCents }`.
- **Pricing:** `quoteWithPoints` in `src/pricing/domain/quote.ts` applies discount, then points (capped at the remaining amount), then tax. The existing `GET /quote` shape is unchanged.
- **Ledger:** `src/loyalty/domain/points.ts` has earliest-expiry-first allocation and the restore/forfeit split. `src/loyalty/integration/loyalty-store.ts` stores redemption records (allocations, quote, reversed flag).
- **Use cases:** `src/orders/application/order-payments.ts` holds redeem and cancel. Both run under a per-customer lock (`src/common/keyed-lock.ts`), created once in `src/app.ts`.
- **Cancel:** now async. Cancelling a redeemed order restores points to their original lots and expiry, and forfeits points whose lot has expired.
- **Tests:** `tests/orders/redeem-order.test.ts`.

**Verification**

- `npm test`: 24 pass, 0 fail.
- I temporarily removed the lock: the concurrency test then accepted 4 redemptions of 300 points from a 1000-point balance. With the lock restored it accepts 3. The lock is what prevents the overspend.

**Decisions you may want to change**

- One redemption per order. A second redemption with a new key returns 409.
- Points applied are `min(requested, amount)`. If the balance is below that, the request is rejected with 409 `INSUFFICIENT_POINTS`. Nothing is partially applied.
- Idempotency is scoped per customer. A replay returns the stored quote, even if the order was cancelled later. A key reused with another order or another point count returns 422.
- Errors carry an `error_code` field in addition to `error`.
- `createApp` now honours the `now` option, which it previously ignored.

**Not done or unsure**

- The order record itself is not changed by redemption, so `GET /orders/:id/quote` still shows the pre-points total.
- There is no type-check: the repo has no TypeScript dependency. Node only strips types at run time.
- Multi-lot writes are not compensated. If a ledger write fails midway, the earlier writes stay. The in-memory store cannot fail on the validated values, but a real database could. Reversal has the same gap: a partial restore followed by a failure could double-restore on retry.
- The lock only serialises calls within one process.
- The cancel route now returns `error_code` on its errors as well.