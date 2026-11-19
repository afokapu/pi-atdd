Smoke test confirms the full flow with real seed data: redeem 400 points on `o1` → `{subtotalCents: 5048, discountCents: 505, pointsCents: 400, taxCents: 787, totalCents: 4930}` (tax on the point-reduced base), replay identical, cancel restores points.

## Report

### What I changed

**Domain (pure rules)**
- `src/loyalty/domain/points.ts` — `consumablePoints` (cap at cents due; 1 point = 1 cent), `planConsumption` (non-expired lots, earliest expiry first), `planRestoration` (back to original lots; expired lots forfeited), plus `Allocation`/plan types.
- `src/pricing/domain/quote.ts` + `quote-service.ts` — `quoteWithPoints`/`quoteForOrderWithPoints`: subtotal → discount → points → tax on the remainder; floor at zero, surplus not applied; tax rounds once.
- `src/orders/domain/order.ts` — `Order.redemption` (per-lot allocations, recorded for exact reversal) and `redeem`/`assertRedeemable` rules (pending + not already redeemed).

**Integration**
- `src/orders/integration/idempotency-store.ts` (new) — `(orderId, key)` → `{ fingerprint, stored response }`, insert-if-absent.
- `src/loyalty/integration/loyalty-store.ts` — `runExclusive(customerId, fn)`: per-customer promise-chain critical section, so concurrent redemptions/cancellations for one customer never interleave their read-decide-write.

**Application**
- `src/orders/application/redeem-order.ts` (new) — `redeemOrderPoints`: inside one per-customer section → ownership 404 → idempotent replay (same key) or 409 (same key, different body) → eligibility before touching the ledger → capped consumption → order update → idempotency record stored in the same section. Also `applyRestoration`.
- `src/orders/application/cancel-order.ts` (new) — `cancelOrder`: cancel + restore recorded allocations atomically; expired lots forfeited; status guard makes restore run exactly once.

**Presentation / composition**
- `src/orders/routes/order-routes.ts` — `POST /orders/:id/redeem` (400 validation, 401/404/409 mapping), cancel now goes through the application use case.
- `src/app.ts` — wires `loyalty`, `now`, and a new optional `idempotency` dep (created in the composition root).

### How I verified
37/37 tests pass (`npm test`), including 25 new: domain unit tests (earliest-expiry order, expiry boundary, caps, forfeiture, quote ordering), acceptance tests (auth/ownership, validation, after-discount-before-tax with exact cents, zero floor, insufficient points, key replay incl. replay-after-order-change, key-mismatch 409, per-order key scope, second redemption 409, **three `Promise.all` concurrency scenarios** — disjoint consumption, single side effect under retries, one winner among different keys, cancel-restores/forfeits). Plus a smoke run through the real seed data.

### Not done / notes
- Redeem returns exactly the five spec'd fields (`subtotalCents, discountCents, pointsCents, taxCents, totalCents`) — no `region`.
- A redemption that consumes 0 points (no usable lots) returns 200 with `pointsCents: 0` and leaves the order unmarked (nothing to reverse); the idempotency record is still kept.
- Only one redemption per order (second attempt with a different key → 409) — this keeps "cancel returns points" well-defined.
- `GET /orders/:id/quote` still returns the base quote without points (spec only defines the redeem response); left unchanged.
- Idempotency records live in the in-memory store only, consistent with the rest of the service's storage.