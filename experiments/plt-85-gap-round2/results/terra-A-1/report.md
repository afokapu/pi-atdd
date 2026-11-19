Implemented LOY-002.

- Added `POST /orders/:id/redeem` with validation, ownership/pending checks, idempotency, lot-expiry/FIFO spending, and points-aware quotes.
- Persisted redemption lot allocations so cancellation restores non-expired points to original lots/expiry.
- Added per-customer async ledger serialization to prevent concurrent overspending.
- Added acceptance tests for pricing, idempotency, expiry forfeiture, cancellation, and concurrency.

Verified with `npm test` (12 passing).