Implemented LOY-002.

- Added `POST /orders/:id/redeem` with validation, ownership/pending checks, idempotency replay/conflict handling, and quote response including `pointsAppliedCents`.
- Added earliest-expiry, non-expired lot consumption under a per-customer async lock.
- Persisted redemption allocations for exact cancellation restoration; expired lots are forfeited on cancellation.
- Added points-aware pricing: discount → points → tax, all integer cents.
- Wired loyalty and clock dependencies through `createApp`.

Verified with `npm test` (9 passing) and a manual redemption/replay/cancellation check.