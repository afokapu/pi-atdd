I added `POST /orders/:id/redeem`. All 19 tests pass: the 9 existing ones plus 10 new ones. One gap: two of my concurrency tests still passed with the lock turned off, so they don't prove the lock is needed for those cases.

**What I changed**
- **Points rules** (`src/loyalty/domain/points.ts`): 1 point = 1 cent. A new `planConsumption` takes points from lots that haven't expired, earliest expiry first. If there aren't enough points it rejects the request without spending anything.
- **Pricing** (`src/pricing/domain/quote.ts`, `quote-service.ts`): a new `quoteWithPoints` applies discount, then points, then tax. Points can't take the amount below zero.
- **Orders** (`order.ts`, `order-store.ts`): an order now records each redemption, including which lots the points came from and how many.
- **Loyalty ledger** (`src/loyalty/application/`): a per-customer lock so that redeem and cancel for one customer run one at a time. It also handles spending points and returning them to their original lots; points whose lot has expired by then are forfeited.
- **Idempotency** (`src/loyalty/integration/idempotency-store.ts`): an asynchronous in-memory store. Keys are per customer, and a key is tied to the order and the number of points.
- **Redeem and cancel** (`src/orders/application/order-payments.ts`): redeem caps the points at what's still owed, so excess points aren't consumed. Cancel now returns points to their lots.
- **Routes** (`order-routes.ts`): the new redeem route, cancel going through the new code, and `GET /orders/:id/quote` showing points once some have been redeemed.
- **Wiring** (`src/app.ts`): `createApp` keeps its signature and gains two optional settings, `idempotency` and the existing `now`.

**Response:** `{ region, subtotalCents, discountCents, pointsApplied, pointsAppliedCents, taxCents, totalCents }`.

**Status codes:** 400 for bad input, 401 if not signed in, 404 if the order doesn't exist or isn't yours, 409 if the order isn't pending or there aren't enough points, 422 if a key is reused with a different body.

**How I verified it**
- The new tests in `tests/orders/redeem-points.acceptance.test.ts` cover:
  - the maths;
  - which lots are used first, including expired lots and a lot expiring at exactly the current time;
  - not having enough points;
  - the zero floor and leftover points;
  - reusing a key, sequentially and concurrently;
  - concurrent redemptions across several orders;
  - who can redeem and input checks;
  - cancel returning points with the original expiry, and forfeiting expired ones;
  - cancel and redeem racing each other.
- With the lock disabled, the multi-order "never spend the same points" test fails, so that test does catch the race.
- The concurrent same-key and cancel-vs-redeem tests passed even without the lock, so they don't show it's needed.

**Choices you may want to change, and limits**
- **Several redemptions per order** are allowed, each with its own key, and they add up. Over-asking is capped at the amount still owed. Asking for more points than the customer has is rejected outright rather than partly applied.
- **Only successful requests are remembered by key.** Errors aren't stored, so a client can retry after a failure.
- **On a repeated key, the stored response is returned as-is**, even if the order has changed since (for example, it was cancelled).
- **The lock only works inside one process and one app instance.** The store has no compare-and-swap or transactions, so several instances or other writers to the ledger could still spend the same points twice.
- **Partial failures:**
  - Redeem undoes the points it took if saving the order fails.
  - Cancel saves the order first and returns points after. If returning points fails partway, the customer loses them and there is no retry or outbox.
- **Rounding:** with 1 point = 1 cent there's no rounding issue. If the rate changes, `centsToPoints` rounds down.
- **Idempotency records are kept in memory only.**