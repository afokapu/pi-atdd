Implemented LOY-002.

- Added authenticated `POST /orders/:id/redeem`.
- Added expiry-ordered, atomic loyalty lot consumption with idempotency protection.
- Added discounted/pre-tax points quoting and persisted redemption audit data.
- Redeemed orders can be cancelled; valid unexpired points return to original lots.
- Added application ports/service and composition-root wiring.

Verified with `npm test` (9 passing) and a manual redemption/idempotency/refund flow. No known gaps.