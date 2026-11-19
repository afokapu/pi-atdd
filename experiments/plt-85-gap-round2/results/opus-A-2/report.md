I added `POST /orders/:id/redeem`. All 19 tests pass: the 7 that were already there and 12 new acceptance tests for LOY-002.

**What I changed**
- **Points rules** (`src/loyalty/domain/points.ts`): pure functions that take points from lots that haven't expired, earliest expiry first, and give them back on cancel. Points whose lot has expired by then are lost. 100 points = €1, so 1 point = 1 cent.
- **Pricing** (`src/pricing/domain/quote.ts`, `quote-service.ts`): a new `withPoints` applies points after the discount and before tax, never going below zero, and recalculates tax on what's left.
- **Orders**: an order now records each redemption: its key, the points used, and which lots they came from. The order store copies these too.
- **New files**:
  - `src/shared/keyed-lock.ts`: a per-customer lock.
  - `src/loyalty/application/ledger.ts`: spends and refunds points. If saving lots fails partway, it tries to undo the ones already saved.
  - `src/orders/application/order-payments.ts`: the redeem and cancel logic.
- **Redeem**:
  - Every redeem and cancel for a customer runs under that customer's lock, so two requests can't spend the same points.
  - Points used are capped at what's still owed after discount and earlier redemptions; extra points aren't taken.
  - Each key is stored per customer. The same key with the same body returns the saved result (even after the order is cancelled). The same key with a different order or point count is rejected.
- **Cancel** now runs through the same lock and returns points to their original lots, keeping the original expiry.
- **Responses**:
  - Redeem returns `{ region, subtotalCents, discountCents, pointsApplied, pointsCents, taxCents, totalCents }`.
  - `GET /orders/:id/quote` returns this shape only when points have been used; otherwise it's unchanged.
  - Errors: 400 bad body, 401 not signed in, 404 order missing or not yours, 409 order not pending or not enough points, 422 key reused with a different body.
- `createApp` takes a new optional `idempotency` setting; its signature is otherwise unchanged.

**How I checked it**
- New test file `tests/orders/redeem-points.acceptance.test.ts` covers:
  - the discount → points → tax order
  - lot order, including a lot that expires at exactly the current time
  - the zero floor and leftover points not being taken
  - not enough points
  - key replay and a reused key with a different body
  - concurrent requests
  - who may redeem and request validation
  - cancel with one lot expired by then
  - `GET /orders/:id/quote` matching the redeem result
- With the lock removed, the test for two concurrent redemptions on different orders fails.
- A strict `tsc` type-check found no errors in the code; it only complained that Node's type definitions aren't installed.

**Decisions to confirm, and limits**
- **Not enough points:** I reject the request (409) instead of applying whatever the customer has. This is a judgement call; please confirm.
- **Several redemptions per order:** allowed with different keys, and they add up.
- **Lost points aren't recorded anywhere:** when points are forfeited on cancel, nothing is logged or returned.
- **The lock and stored keys only live inside one running app.** With several server instances or a restart, protection would need the database (transactions or conditional writes, and a stored key table).
- **Partial failures:** if saving lots fails partway, the undo is best-effort. A failure between saving the lots and saving the order could leave them out of step, because the store has no transactions.
- **Concurrent test for the same key:** it passes even without the lock, because the duplicate writes save the same values. The test for different orders is the one that really checks the lock.