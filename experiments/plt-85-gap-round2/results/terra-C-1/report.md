Implemented LOY-002.

- Added `POST /orders/:id/redeem` with validation, ownership/pending checks, idempotency replay/conflict handling, and quote response including `pointsAppliedCents`.
- Added FIFO non-expired lot consumption under a per-customer async lock.
- Recorded allocations and original response on orders; cancellation restores original unexpired lots.
- Added points-aware pricing: discounts → points → tax, all integer cents.
- Extended loyalty store with indexed valid-lot lookup and batch lot lookup.

Verified with `npm test` (9 passing) and `git diff --check`. TypeScript compiler was not installed, so no standalone `tsc` check was possible.