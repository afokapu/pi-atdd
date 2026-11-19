`POST /orders/:id/redeem` is implemented and the full suite passes (22 tests, 13 of them new). I didn't commit anything.

**What changed**
- `src/loyalty/domain/points.ts`: usable lots sorted earliest-expiry-first, allocation that never over-debits, and a `Redemption` record.
- `src/pricing/domain/quote.ts` and `quote-service.ts`: `quoteWithPoints` applies points after discount and before tax, clamped at zero. The existing `quote()` output is unchanged.
- `src/loyalty/integration/loyalty-store.ts`: stores redemptions, looked up by order and by customer+idempotency key.
- `src/loyalty/application/customer-lock.ts`: a per-customer queue. Redeem and cancel both run under it.
- `src/orders/application/redeem-order.ts` and `src/orders/routes/redeem-route.ts`: the use case and the HTTP handler.
- `src/loyalty/application/release-redemption.ts`: on cancel, returns each allocation to its original lot. Lots that have expired by then are forfeited.
- `src/orders/routes/order-routes.ts` and `src/app.ts`: cancel now releases points under the lock. The loyalty store and clock are passed into the routes.
- `tests/loyalty/redeem-points.acceptance.test.ts`: covers each rule in the spec.

**How I verified it**
- `npm test`: all 22 pass.
- The concurrency test fails when the lock is disabled and passes with it. I restored the lock afterwards.

**Decisions and gaps**
- **Over-balance requests are rejected** with 409. The spec only covers points beyond the amount due, which are capped and not consumed.
- **One redemption per order.** A second one returns 409.
- **Replays return the stored result**, even if the order is cancelled later.
- **Error bodies use `{ error }`** to match the existing routes, not `error_code`.
- **The lock is process-local.** Several instances would need the guarantee in the ledger database, for example a conditional update on the lot.
- **No transaction across lot writes.** If the store fails midway through a debit, some lots could be debited without a redemption record. The in-memory store can't fail this way, but a real ledger needs a transaction.
- **Not run:** the project's ATDD/Bun detectors (none are in the repo), and a TypeScript type check (no `tsc` available). Verification is by tests only.