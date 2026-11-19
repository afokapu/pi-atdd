LOY-002 is implemented: `POST /orders/:id/redeem` works, and cancelling a redeemed order returns its points. The full suite passes (21 tests, 12 of them new).

**What changed**
- **Pricing** (`src/pricing/domain/quote.ts`, `application/quote-service.ts`): new `quoteWithPoints` applies points after discount and before tax, in integer cents. The existing `quote` and `GET /orders/:id/quote` output is unchanged.
- **Loyalty domain** (`src/loyalty/domain/redemption.ts`, new): pure rules for applicable points (capped by the discounted amount and by usable points), earliest-expiry allocation, debit, and reversal, where expired lots forfeit their points.
- **Loyalty ledger** (`src/loyalty/application/ledger-port.ts`, `src/loyalty/integration/loyalty-store.ts`): a port plus an adapter that adds usable-lot queries, redemption records indexed by order and by (customer, key), and a per-customer async lock.
- **Orders** (`src/orders/application/redeem-order.ts`, `cancel-order.ts`, `src/orders/routes/redeem-routes.ts`, `order-routes.ts`, `src/app.ts`): the redeem use case and route, and cancel now returns points inside the same customer lock.
- **Tests** (`tests/orders/redeem-points.acceptance.test.ts`): covers allocation order, expired lots, discount-then-points-then-tax, excess and zero-floor, idempotent replay, key reuse with a different body, restore on cancel, forfeit on cancel after expiry, concurrency, ownership, state, and validation.

**How I verified it**
- `npm test`: 21 pass, 0 fail.
- The concurrency test fails when the per-customer lock is removed, so it does exercise the lock.

**Choices you may want to change**
- 1 point = 1 cent, from 100 points = €1.
- An order takes at most one redemption. A second redemption with a different key returns 409 `ORDER_ALREADY_REDEEMED`.
- Errors from the new endpoint use `error_code` (for example `IDEMPOTENCY_KEY_REUSED`, `ORDER_NOT_PENDING`). Existing routes still use the older `{ error }` shape.
- The success body is the quote with a `pointsCents` field. Region is included because the existing quote includes it.
- A redeem with no usable points succeeds with `pointsCents: 0` and still records a redemption, so that order is then locked to one redemption.

**Not done or uncertain**
- Nothing is type-checked: no TypeScript compiler is installed, so the code runs only through Node's type stripping.
- The in-memory store has no transactions. A failure partway through a redeem or cancel could leave lots and the order out of step.
- The order itself does not record the applied points, and nothing finalises payment.
- The lock only works inside one process.
- `order-routes.ts` already imported the order store from the integration layer and has a low comment ratio. I left both as they were.