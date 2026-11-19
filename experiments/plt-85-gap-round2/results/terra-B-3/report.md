Implemented LOY-002.

- Added authenticated `POST /orders/:id/redeem`.
- Consumes unexpired lots by earliest expiry under an async per-customer transaction.
- Applies points after discount/before tax; caps consumption to the remaining discounted balance.
- Supports idempotency and rejects same key with different points.
- Stores lot allocations and restores eligible points to original lots on cancellation.
- Added points-aware quote calculation (`pointsAppliedCents`).

Verified with `npm test`, a manual idempotency/redemption check, and `git diff --check`.