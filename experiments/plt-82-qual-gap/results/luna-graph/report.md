Implemented LOY-002:

- Added `POST /orders/:id/redeem`.
- Added FIFO-by-expiry point consumption with atomic async ledger mutations.
- Added idempotency handling and conflict detection.
- Applied points after discounts and before tax.
- Added cancellation refunds to original, non-expired lots.
- Wired loyalty and clock dependencies through `createApp`.

Verified with `npm test` — all 9 tests pass.

No known outstanding issues.