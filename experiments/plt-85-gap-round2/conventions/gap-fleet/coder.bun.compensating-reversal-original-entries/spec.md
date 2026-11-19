Rule id: `coder.bun.compensating-reversal-original-entries`

Topic: undoing (cancel/refund/void) an operation that consumed amounts from several source entries (e.g. buckets, batches, allocations with their own attributes such as a validity window or cost basis).

Obligation to capture: record, at consumption time, exactly which source entries were drawn and by how much, and reverse by restoring those amounts to the same entries with their original attributes, applying the rules in force at reversal time (e.g. an entry whose validity has ended by then is not restored).

Knowledge to carry:
- Store an allocation record per source entry (entry id, amount) with the consuming operation; never reconstruct it later from current state.
- Reversal restores to the original entries (not a new generic credit with fresh attributes), so attributes like validity end date or cost basis are preserved.
- Evaluate time-dependent rules at reversal time using the injected clock (not the system clock, not the consumption time); amounts whose entry is no longer valid are forfeited/not restored per policy, and the outcome records what was restored vs forfeited.
- Reversal is idempotent (reversing twice restores once) and happens in the same critical section discipline as the original consumption.
- Evidence: tests reversing a multi-entry consumption (each entry restored to its original id and attributes, no new entries), and with the clock advanced past one entry's validity (that part not restored).
