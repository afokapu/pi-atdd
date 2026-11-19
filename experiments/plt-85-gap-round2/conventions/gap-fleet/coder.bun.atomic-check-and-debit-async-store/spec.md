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
