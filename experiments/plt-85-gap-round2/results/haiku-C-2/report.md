LOY-002 is implemented: `POST /orders/:id/redeem` works, and cancelling a redeemed order returns points to their original lots. `npm test` passes (28 tests, up from 9).

**What changed**
- **Pricing** (`src/pricing/domain/quote.ts`, `quote-service.ts`): new `quoteWithPoints`. Order is subtotal → discount → points (capped at the remaining amount, so never below zero) → tax on the rest. The existing `quote` is untouched.
- **Loyalty domain** (`src/loyalty/domain/points.ts`, new `redemption.ts`): usable lots are those with points left and `expiresAt` strictly after now, earliest expiry first. Allocations are recorded per lot. Restore puts points back only into lots still unexpired at cancel time and reports the rest as forfeited.
- **Ledger** (`src/loyalty/integration/loyalty-store.ts`): redemption records, one per order.
- **Concurrency** (`src/loyalty/application/customer-lock.ts`): a per-customer queue around redeem and cancel. The store yields on every call, so without it two redeems could both spend the same points. I checked this: with the lock removed the concurrency test fails.
- **Use cases and routes** (`src/orders/application/order-redemption.ts`, `routes/order-routes.ts`, `app.ts`): redeem and cancel. The cancel route now also reverses any redemption. Its success response is unchanged.

**Verification**
- Acceptance tests in `tests/loyalty/redeem-points.acceptance.test.ts` cover: the worked example (SAVE10 + 600 points, lots drawn in expiry order, expired lot untouched, exact tax and total), excess points not consumed, idempotent replay, same key with a different body rejected, a second key on the same order rejected, parallel redemptions, insufficient points, cancel restore, cancel after expiry (forfeit), double cancel, shipped and foreign orders, and invalid bodies.
- Domain tests in `tests/loyalty/points-domain.test.ts` cover the expiry boundary, restore/forfeit, and rounding.
- I did not run the repo's ATDD/complexity detectors; none were present in the workspace.

**Decisions to review**
- **One redemption per order.** A second key on the same order returns 409. This keeps replay scope simple.
- **Idempotency scope is (order, key).** The same key on a different order is treated as a new request.
- **Insufficient points returns 409.** The request is rejected if `points` exceeds the usable balance, even if the amount would cap it lower.
- **Points are 1 cent each** (100 points = €1), so `pointsAppliedCents` equals points consumed.
- **Order status stays `pending` after redemption.** Only the cancel path changes behaviour.

**Not done / unsure**
- **`GET /orders/:id/quote` ignores redemptions.** It still shows the pre-points total. Making it reflect redemptions is a follow-up.
- **No atomicity across the in-memory stores.** Lot debits and the redemption record are written as separate awaits. A real database would need a transaction.
- **Lot reads fetch all of a customer's lots.** This is fine for the in-memory store but not for the history-scan rule. A keyed "usable lots" query would fix it.
- **Nothing committed.** Changes are in the working tree only. There is no `tsc` in the workspace, so type errors were not checked.