Implemented LOY-002.

- Added `POST /orders/:id/redeem` with validation, ownership checks, idempotency replay/conflict handling, and stored quote responses.
- Added FIFO non-expired lot consumption under per-customer async locking.
- Added points-aware pricing: discount → points → tax, integer cents.
- Added redeemed-order cancellation that restores original lot allocations unless expired.
- Indexed loyalty lots by customer and added batch lot updates/lookups.

Verified with `npm test`, `git diff --check`, plus a manual redemption/replay/cancellation flow.