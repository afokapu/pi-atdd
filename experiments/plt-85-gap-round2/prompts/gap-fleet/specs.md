# Gap convention specs (PLT-85 Arm C)

Declared bias: these specs were written by the operator knowing which traps PLT-82's catalog left uncovered. They are phrased as general engineering rules; Arm C is a best case.

<!-- spec: coder.bun.money-integer-minor-units-adjustment-order -->
Rule id: `coder.bun.money-integer-minor-units-adjustment-order`

Topic: computing a payable amount from a base price plus adjustments (discounts, credits, vouchers, stored value applied as payment) and tax.

Obligation to capture: represent every monetary amount as an integer number of minor units (e.g. cents) and apply adjustments in an explicit, documented order — price reductions before tax, tax computed on the reduced taxable base — with a single, explicit rounding step per derived amount.

Knowledge to carry:
- No floating-point currency arithmetic; conversions from another unit (e.g. a stored-value unit, a percentage) into minor units happen once, with explicit integer rounding.
- Reductions (discounts first, then credits/stored value used as payment, unless the domain defines otherwise) apply before tax; tax is computed on the amount after reductions and rounded once.
- An amount never goes below zero; a credit or stored-value source is consumed only up to the amount it actually offsets (any excess is left untouched, not consumed and not lost).
- Return all components of the computation (subtotal, each reduction, tax, total) so callers and tests can check the order.
- Keep the calculation as a pure domain function with explicit inputs (rates, amounts), not spread across the route.
- Evidence: unit tests with boundary values (reduction equal to / larger than the base, rounding half cases, zero).

<!-- spec: coder.bun.idempotent-replay-stored-result -->
Rule id: `coder.bun.idempotent-replay-stored-result`

Topic: a mutating operation that accepts an idempotency key from the client.

Obligation to capture: on a repeated request with the same idempotency key, return the stored original result without re-executing side effects or recomputing it from current state, after re-authorising the caller; reject the same key sent with a different request payload.

Knowledge to carry:
- Persist, per key (scoped to the caller/resource), a fingerprint of the normalised request payload and the full original response, in the same atomic step as the side effect.
- On replay: authenticate and authorise the caller again exactly as for a first request (the key is not a credential); then compare the fingerprint; same → return the stored response verbatim (do not recompute from current prices/configuration/state); different → reject with a 4xx conflict/unprocessable error and perform nothing.
- Concurrent requests with the same key must not both execute: check-and-record the key inside the same critical section as the side effect.
- Do not key replay only by key string globally (cross-tenant collisions) — scope by caller/resource.
- Evidence: tests for replay (no extra side effect, identical body), mismatch (4xx, nothing changed), replay by a different caller (rejected like a first request), and replay after configuration change (stored result returned).

<!-- spec: coder.bun.atomic-check-and-debit-async-store -->
Rule id: `coder.bun.atomic-check-and-debit-async-store`

Topic: reading a balance/stock/quota from an asynchronous store, deciding, then decrementing it.

Obligation to capture: make the check and the decrement one critical section per owner (serialise per key or use an atomic compare-and-set/conditional write), so concurrent requests can never spend the same units.

Knowledge to carry:
- Any `await` between reading and writing opens a race window; in-process async code is concurrent even on a single thread.
- Options: a per-owner async mutex/queue in the application or store adapter; a store-level conditional update (expected version / compare-and-set) with retry; never a global lock held across unrelated owners when a per-owner one suffices.
- Re-validate every precondition (entity status, ownership, idempotency key, available amount) inside the critical section, not only before acquiring it.
- Do every fallible step that does not depend on the debit (pricing, tax/configuration lookup, validation) before the debit; if a step after the debit can fail, compensate (undo the debit) before returning the error, so a failure never leaves units debited without a recorded result.
- Persist the debit and the record of what it paid for together (or in a compensable order).
- Evidence: a concurrency test firing N parallel requests (Promise.all) against the async store: total debited ≤ available, no negative balance, sum applied == sum removed; a test where a post-debit step fails leaves the balance unchanged.

<!-- spec: coder.bun.compensating-reversal-original-entries -->
Rule id: `coder.bun.compensating-reversal-original-entries`

Topic: undoing (cancel/refund/void) an operation that consumed amounts from several source entries (e.g. buckets, batches, allocations with their own attributes such as a validity window or cost basis).

Obligation to capture: record, at consumption time, exactly which source entries were drawn and by how much, and reverse by restoring those amounts to the same entries with their original attributes, applying the rules in force at reversal time (e.g. an entry whose validity has ended by then is not restored).

Knowledge to carry:
- Store an allocation record per source entry (entry id, amount) with the consuming operation; never reconstruct it later from current state.
- Reversal restores to the original entries (not a new generic credit with fresh attributes), so attributes like validity end date or cost basis are preserved.
- Evaluate time-dependent rules at reversal time using the injected clock (not the system clock, not the consumption time); amounts whose entry is no longer valid are forfeited/not restored per policy, and the outcome records what was restored vs forfeited.
- Reversal is idempotent (reversing twice restores once) and happens in the same critical section discipline as the original consumption.
- Evidence: tests reversing a multi-entry consumption (each entry restored to its original id and attributes, no new entries), and with the clock advanced past one entry's validity (that part not restored).

<!-- spec: coder.bun.indexed-lookup-no-history-scan -->
Rule id: `coder.bun.indexed-lookup-no-history-scan`

Topic: a request handler or use case that needs a small, filtered subset of an owner's records (e.g. currently valid entries, open items) from a store that also holds their full history.

Obligation to capture: fetch only the needed subset through a keyed/indexed store query (by owner, with the filter and ordering pushed into the store or adapter), and write back only the records that changed — the number of store calls and records touched per request must not grow with the owner's history.

Knowledge to carry:
- Do not load all records (or all of an owner's history) and filter/sort in memory in the application layer.
- If the store lacks the needed query, add a narrow query method to the store/adapter (e.g. by owner, valid at time T, ordered by a key) maintained with an index or per-owner structure.
- Write only modified records (update by id), not rewrite the whole collection or every record of the owner.
- Avoid N+1 patterns: one call per record read in a loop.
- Evidence: a test with a large history (e.g. thousands of inactive records) shows store calls / records touched per request are bounded by the number of records actually used; a reviewer sees no full-collection read in the request path.
