Implemented LOY-002:

- Added `POST /orders/:id/redeem`.
- Added FIFO-by-expiry lot consumption with expiry checks.
- Applied points after discounts and before tax.
- Added idempotency handling and serialized ledger mutations for concurrency safety.
- Added redemption tracking and cancellation refunds to original lots, excluding expired points.
- Wired loyalty store and clock dependencies through `createApp`.

Verified with `npm test` and manual redemption/idempotency/cancellation checks. All tests pass.