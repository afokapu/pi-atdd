Implemented LOY-002.

- Added `POST /orders/:id/redeem` with validation, ownership/pending checks, idempotency, and quote response including `pointsAppliedCents`.
- Added serialized async loyalty ledger redemptions, expiry-ordered lot consumption, and cancellation restoration to original unexpired lots.
- Applied points after discount and before tax; persisted redeemed amount for order quotes.
- Serialized order redemption/cancellation operations to avoid races.

Verified with `npm test` and `git diff --check`.