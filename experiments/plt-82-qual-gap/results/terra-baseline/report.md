Implemented LOY-002.

- Added `POST /orders/:id/redeem` with validation, ownership/pending checks, idempotency, expiry-ordered lot consumption, and points-aware tax/quote calculation.
- Added per-customer async ledger locking to prevent concurrent double-spends.
- Persisted redemption lot debits and cached idempotent responses.
- Updated cancellation to restore unexpired points to their original lots.
- Added points-aware quote support while preserving existing quote behavior.

Verified with `npm test` and a manual concurrent redemption/cancellation check.