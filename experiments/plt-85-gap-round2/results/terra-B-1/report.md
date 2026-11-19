Implemented LOY-002.

- Added `POST /orders/:id/redeem` with auth, ownership, pending-order enforcement, validation, idempotency, and cents-based quote response.
- Added expiry-ordered, customer-serialized loyalty lot consumption and original-lot refunds on cancellation.
- Added redeemed order state and cancellation support for redeemed orders.
- Points reduce post-discount/pre-tax taxable amount; excess is not consumed.
- Verified with `npm test` and `git diff --check`, plus a manual redemption/idempotency/refund flow.

No known outstanding issues.