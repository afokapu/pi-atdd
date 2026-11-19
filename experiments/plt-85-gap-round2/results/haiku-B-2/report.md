`POST /orders/:id/redeem` is implemented and the full suite passes (21 tests, 12 of them new). I left the changes uncommitted in the working tree.

**What changed**

- **Pricing:** `quoteWithPoints` in `src/pricing/domain/quote.ts` applies points after discount and before tax, capped so the taxable amount never goes below zero. The existing `quote()` now delegates to it, so the `GET …/quote` output is unchanged.
- **Lots:** `allocatePoints` and `restorable` in `src/loyalty/domain/points.ts` use non-expired lots, earliest expiry first. Each allocation records its lot id, points taken and expiry.
- **Redeem:** `src/orders/application/redeem-points.ts` and `src/orders/routes/redeem-route.ts`. The redemption is stored on the order, which gives idempotency (replay of the same key and body, 409 for a different body) and the data a cancel needs.
- **Cancel:** `src/orders/application/cancel-order.ts` returns points to their original lots and expiry. Lots that have expired by cancel time forfeit their points. The cancel route now calls this use case.
- **Concurrency:** `src/loyalty/application/ledger.ts` has a per-customer lock. Redeem and cancel both run under it.
- **Wiring:** `src/app.ts` passes `loyalty` and `now` to the order routes.
- **Store:** `src/orders/integration/order-store.ts` deep-copies orders with `structuredClone`, so a stored redemption cannot be changed by mutation.

**Verification**

- I wrote `tests/orders/redeem-order.acceptance.test.ts`. It covers the earliest-expiry-first order, the exact cent arithmetic, excess points, expired lots, idempotent replay, key reuse with a different body, concurrent redemptions, a second key on the same order, cancel restoring original lots and expiry, forfeiture after expiry, ownership, shipped orders and invalid bodies.
- I removed the lock for one run and the concurrency test failed, so it does exercise the lock. The lock is back in place and the suite is green.

**Not done / unsure**

- **Idempotency scope:** keys are scoped to the order, not the customer. Reusing a key on a different order is not treated as a conflict.
- **One redemption per order:** a second redemption under a new key on the same order returns 409. I chose this rather than letting a redemption be replaced.
- **Quote endpoint:** `GET /orders/:id/quote` still ignores redemptions, so it does not show points on a redeemed order. The redeem response does show them.
- **Error shapes:** the new and cancel error responses now include `error_code`. Cancel's 409 changed from `{error}` to `{error, error_code}`.
- **Order JSON:** orders now carry a `redemption` field in their JSON.
- **Atomicity:** the in-memory stores have no transactions. If a lot write fails partway through a redemption, earlier debits are not rolled back. The lock is also process-local.
- **Not run:** there is no `tsc` in the repo, so the code is untyped-checked (the tests run through Node type stripping). I did not run the project's ATDD/Bun detectors, and I did not check the comment-ratio or complexity rules.