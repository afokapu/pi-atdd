Done. All 28 tests pass (9 pre-existing + 19 new), strict `tsc` is clean, and existing behavior is unchanged.

## What I changed

**New files**
- `src/loyalty/domain/redeem.ts` — pure planning: `planSpend` consumes non-expired lots strictly earliest-expiry-first (capped by request and balance, never below zero); `planRefund` restores deductions to their *original* lots and forfeits points whose lot expired (or vanished).
- `src/orders/application/redeem-service.ts` — `RedeemService` with `redeem()` and `cancelOrder()` (cancel + refund under one per-customer lock). The lock is a per-customer promise chain, so concurrent redemptions/refunds for one customer serialize even though the stores are async; different customers never block each other.
- `src/orders/integration/redemption-store.ts` — async ledger recording each redemption: key, requested/applied points, per-lot deductions, the exact quote returned, and a `refunded` flag.
- Tests: `tests/orders/redeem-order.acceptance.test.ts` (11 cases), `tests/orders/cancel-redeemed.acceptance.test.ts` (4), `tests/loyalty/redeem-plan.test.ts` (4).

**Modified**
- `src/pricing/domain/quote.ts` + `src/pricing/application/quote-service.ts` — `quoteWithPoints`/`quoteForOrderWithPoints`: points reduce the amount after discount, before tax, capped at the discounted subtotal. Base `Quote` shape untouched (existing tests `deepEqual` on it).
- `src/orders/routes/order-routes.ts` — new `POST /orders/:id/redeem` (auth guard first, 400 on bad body, 404 not-owner, 409 not-pending/key-conflict, 200 + new quote); cancel route now goes through the service so refunds happen under the same lock.
- `src/app.ts` — composition root constructs `InMemoryRedemptionStore` + `RedeemService` (injectable via optional `AppDeps.redemptions`); `pointsToCents` helper in loyalty domain (100 points = €1 ⇒ 1 point = 1 cent).

## How I verified
- Full suite green; concurrency is genuinely tested: I temporarily removed the lock and the "never spend the same points" test failed, confirming the test detects double-spending.
- Quote math checked against seeded-style lots (e.g. 10000¢ order, 250 pts → tax on 9750¢); refund-with-expiry uses two `createApp`s sharing stores with the clock advanced between redeem and cancel.

## Interpretations / not done
- **Insufficient balance** isn't specified: I chose to apply `min(requested, available, amountDue)` (matches "excess points are not consumed"; response's `pointsCents` shows the actual amount) rather than erroring.
- Idempotency is checked *before* the pending-status check, so a retry after the order changed state still replays the stored result.
- `GET /orders/:id/quote` intentionally still returns the base quote (points state lives in the ledger); refund-on-cancel is atomic only per customer in-process — no cross-store transactionality (out of scope for the in-memory service).