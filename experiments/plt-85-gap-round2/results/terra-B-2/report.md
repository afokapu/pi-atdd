Implemented LOY-002.

- Added `POST /orders/:id/redeem` with auth/ownership, pending-order validation, input validation, idempotency handling, and quote response including `pointsAppliedCents`.
- Added atomic per-customer loyalty ledger redemption with expiry-order lot consumption and async-safe locking.
- Stored lot allocations on orders; cancellation restores unexpired points to their original lots.
- Added points-aware pricing: points apply after discounts and before tax.

Verified with `npm test` and a manual redemption/idempotency/cancellation scenario.