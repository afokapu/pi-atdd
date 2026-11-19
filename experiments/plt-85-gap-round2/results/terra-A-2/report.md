Implemented LOY-002.

- Added `POST /orders/:id/redeem` with ownership/pending validation, input validation, idempotency handling, and redemption quote response.
- Added atomic customer-level loyalty ledger redemption, expiry-order lot consumption, refunds to original unexpired lots, and idempotency conflict detection.
- Added points-aware pricing: points apply after discount and before tax.
- Updated cancellation to refund redeemed points.
- Added redemption acceptance tests.

Verified with `npm test` (11 passing) and `git diff --check`.