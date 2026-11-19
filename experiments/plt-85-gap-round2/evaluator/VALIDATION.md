# v2 evaluator validation

## Frozen deliverables

- `hidden/acceptance.test.ts`: 33 counted node:test cases, no dependencies.
- `hidden/store-counter.ts`: generic store instrumentation and yielding subclass.
- `hidden/cases.json`: fixed catalog, including import-failure fallback.
- `run-hidden.mjs`: unchanged two-argument interface, disposable copy, 180-second process-group timeout, JSON and log output.
- `rubric.md`: v1's ten 0–3 criteria, with v2 extensions; total 30; lexicographic ranking starts with counted passes / 33.
- `MANIFEST.json`: SHA-256 hashes of all deliverable files except itself.

| Trap | Counted cases |
|---|---:|
| T-ORDER | 4 |
| T-LOTS | 2 |
| T-IDEM | 6 |
| T-RACE | 4 |
| T-REVERSAL | 4 |
| T-AUTH | 3 |
| T-PENDING | 2 |
| T-CLOCK | 2 |
| T-FAIL | 3 |
| T-EFF | 3 |
| **Total** | **33** |

There are no informational tests. The 16 v1 counted cases remain; race cases now additionally check persisted quotes and use the yielding adapter. Seventeen cases were added. No coder result was inspected.

## Reproduction and environment

Validated with Node **v26.4.0**, using built-in TypeScript stripping, node:test, and no installed dependencies. The suite uses Node >=22's requested Date-only mock timer API; no setTimeout/setImmediate scheduler is mocked. The available runtime was v26; older Node releases were not separately executed.

From this evaluator directory:

```sh
node run-hidden.mjs base scratch/validation/base
node run-hidden.mjs scratch/correct scratch/validation/correct-1
# All five reference runs and isolated mutants, including input hash assertions:
node scratch/validate.mjs
# Standalone instrumentation checks (uses the copy under scratch/correct):
node scratch/counter-selftest.ts
```

The final `scratch/validate.mjs` run checks each input tree's SHA-256 aggregate before/after its runner invocation, asserts expected pass counts, and rejects any collateral mutant failure outside its designated trap(s). All input hashes matched, including `base/`. Neither `base/` nor `v1/` was edited. All generated trees, run copies, raw logs, JSON, reference code, and validation helpers live under `scratch/`.

`run-hidden.mjs` was also exercised on `scratch/broken/`, whose composition root imports a nonexistent module. It returned its normal JSON result and log without crashing: all **33 counted tests failed**, `storeCalls.unavailable` was true, and the subprocess exited nonzero. The base likewise produced **0/33** with no runner crash. Missing/import-failed cases cannot disappear from the denominator.

The literal direct command `node --test "evaluator-hidden/*.test.ts"` was run in `scratch/direct/` after copying the correct tree and `hidden/`: **33 passed, 0 failed** (`scratch/validation/direct.log`). The correct reference also passes the base public suite: **9 passed, 0 failed** (`scratch/validation/public.log`).

## Final validation results

| Input | Counted pass | Counted fail | Relevant result |
|---|---:|---:|---|
| `base/` | 0/33 | 33 | All counted cases fail; runner returns normally |
| `scratch/broken/` | 0/33 | 33 | Import failure; fixed catalog and unavailable measurements |
| `scratch/correct/`, run 1 | 33/33 | 0 | Final suite |
| `scratch/correct/`, run 2 | 33/33 | 0 | Final suite |
| `scratch/correct/`, run 3 | 33/33 | 0 | Final suite |
| `scratch/correct/`, run 4 | 33/33 | 0 | Final suite |
| `scratch/correct/`, run 5 | 33/33 | 0 | Final suite |
| `scratch/naive/` | 16/33 | 17 | Separates the requested v2 defects |
| `scratch/race/` | 29/33 | 4 | Only T-RACE fails |
| `scratch/replay-ownership/` | 32/33 | 1 | Only owner-key intrusion case fails |
| `scratch/replay-recompute/` | 32/33 | 1 | Only reconfigured-tax replay case fails |
| `scratch/samekey/` | 31/33 | 2 | Only concurrent duplicate/mismatch T-IDEM cases fail |
| `scratch/failure/` | 30/33 | 3 | Only T-FAIL fails |
| `scratch/reversal/` | 29/33 | 4 | Only T-REVERSAL fails |
| `scratch/eff/` | 31/33 | 2 | Only fresh/next-order T-EFF fails |

Five consecutive final-suite correct-reference runs passed, with no skips, cancellations or timeouts. Raw results are in `scratch/validation/<name>/hidden-result.json` and `hidden.log`; `scratch/validation/summary.json` aggregates the final checks. Earlier exploratory runs are not the evidence for the five-run claim. A combined replay mutant (`scratch/replay/`) was also checked earlier at 31/33; the final evidence above isolates its two defects independently.

## Correct reference

The private functional reference is `scratch/correct/src/app.ts` plus its loyalty adapter. It has:

- A per-customer promise queue covering authorization/state checks, ledger reads, allocation, debit, order/receipt publication, and compatible cancellation; release runs in `finally`.
- Stored, cloned quotes and request fingerprints (order/key scope plus points), with re-authorization before returning a cached result. The contract does not require global key scope across unrelated orders.
- Fallible discount and tax pricing before debit, and compensation of completed lot writes if later publication fails.
- Exact lot allocation provenance saved on the order, restoration into original identities/expiries only if still live at cancellation, and no second restoration.
- A customer-specific expiry-ordered treap of nonempty lots, separate direct ID lookup, strict-time range queries, and per-changed-lot writes. Expired history is skipped by indexed lookup, not copied into the application.

The reference is functional validation code, not a layering exemplar or rubric-scored coder submission. Its use-case logic is deliberately concentrated in the composition root for easily isolated mutations. It is not read by the hidden tests: tests import only product modules and exercise the public router/stores.

## Naive reference and exact failing cases

`scratch/naive/` uses the same store adapter but ignores the usable-lot index. Its switches select check/read/await/write without customer serialization, response recomputation before replay ownership checking, debit before fallible pricing without compensation, new fresh-expiry refund lots, and full-history reads plus full rewrites. Thus basic pricing/eligibility are still implemented rather than disabled.

It passes **every** T-ORDER (4), T-LOTS (2), T-AUTH (3), T-PENDING (2), and T-CLOCK (2) case. It also passes sequential identical replay, sequential mismatch rejection, and the cheap replay efficiency comparison. The following **17** counted cases fail:

- `[T-RACE] two orders cannot double-spend one asynchronous lot`
- `[T-RACE] six concurrent orders spanning partial lots conserve points`
- `[T-RACE] twelve yielding redemptions conserve a shared balance`
- `[T-RACE] twenty yielding redemptions across seven lots match persisted quotes`
- `[T-IDEM] another signed-in customer cannot replay the owner's receipt`
- `[T-IDEM] replay preserves original quote after tax reconfiguration`
- `[T-IDEM] sixteen simultaneous identical keys execute exactly one debit`
- `[T-IDEM] concurrent mismatched bodies commit only the winning fingerprint`
- `[T-REVERSAL] cancel restores original lots and expiry without new lots`
- `[T-REVERSAL] cancellation forfeits expired allocations but restores live originals`
- `[T-REVERSAL] mixed expiry cancellation twice restores only live original shares`
- `[T-REVERSAL] all allocations expired at cancellation are forfeited`
- `[T-FAIL] unknown region cannot strand debits across multiple lots`
- `[T-FAIL] unknown discount cannot strand debits across multiple lots`
- `[T-FAIL] removed tax configuration cannot strand debits across multiple lots`
- `[T-EFF] fresh lot records and calls stay bounded with 3000 historical lots`
- `[T-EFF] next order lot records and calls stay bounded with 3000 historical lots`

## Isolated defect checks

Each variant otherwise preserves the correct reference:

- **race:** replaces customer locking with key-only locking. Different keys race; same-key serialization still works. Exactly the four T-RACE cases fail, not the replay/basic tests.
- **replay-ownership:** returns a cached receipt before checking the order's owner. Only `[T-IDEM] another signed-in customer cannot replay the owner's receipt` fails.
- **replay-recompute:** retains authorization/fingerprint checks but recomputes cached pricing. Only `[T-IDEM] replay preserves original quote after tax reconfiguration` fails.
- **samekey:** moves receipt lookup outside the customer critical section. Exactly the sixteen-identical-keys and concurrent-mismatched-bodies cases fail, while different-key races remain safe.
- **failure:** moves fallible pricing after debit and omits compensation. All three T-FAIL cases fail; all other 30 pass.
- **reversal:** replaces provenance restoration with one new fresh-expiry refund lot. All four T-REVERSAL cases fail; all other 29 pass.
- **eff:** replaces indexed reads/per-lot writes with `lotsFor` and full rewrites. Fresh and next-order T-EFF fail; replay stays cheap and all other cases pass.

## Efficiency raw numbers

Each measurement excludes constructor/setup, warm-up, ledger snapshots, and assertions. Two otherwise equivalent fixtures have 0 versus 3,000 historical lots and six live lots. Half the history is expired positive balance, half is future-expiring but empty, so filtering only expiry or only positive balance is insufficient.

| Implementation / mode | Small calls | Large calls | Small read/write records | Large read/write records | Small / large total records | Record budget | Call budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Correct fresh | 3 | 3 | 6 / 2 | 6 / 2 | 8 / 8 | 32 | 18 |
| Correct next order | 3 | 3 | 5 / 2 | 5 / 2 | 7 / 7 | 30 | 18 |
| Correct replay | 0 | 0 | 0 / 0 | 0 / 0 | 0 / 0 | 16 | 12 |
| Naive or efficiency mutant fresh | 7 | 3007 | 6 / 6 | 3006 / 3006 | 12 / 6012 | 40 | 26 |
| Naive or efficiency mutant next order | 7 | 3007 | 6 / 6 | 3006 / 3006 | 12 / 6012 | 40 | 26 |
| Naive or efficiency mutant replay | 0 | 0 | 0 / 0 | 0 / 0 | 0 / 0 | 16 | 12 |

A pass requires large records ≤ 2 × small records + 16 **and** large calls ≤ 2 × small calls + 12, as well as a successful 150-point quote and matching ledger delta. Raw samples and computed budgets are included in JSON on either pass or budget failure. The new `usableLotsFor` method is observed: one read call returning six (later five) lots, plus two `saveLot` writes. The full-history implementation fails by thousands of records, not an unstable runtime threshold.

Nine standalone counter scenarios pass: added bulk query, own arrow query, bulk write, internal dispatch, asynchronous stream, synchronous stream, dynamically installed query, lean/partial lot writes, and a method using real #private fields. Repeated record references count per occurrence; cyclic containers are guarded. The counter discovers added methods and recursively examines lot-shaped results/arguments rather than naming only `lotsFor`, `getLot` and `saveLot`.

## Determinism and contract boundaries

- The race fixture really yields with `setImmediate` before/after base store I/O, and delays asynchronous method results, including added methods. No timing sleeps or fake timer ticks are used to arrange races. Requests are launched together and invariants are checked only after settlement.
- The duplicate-key probe can launch eight additional replays immediately after a public `saveLot` commits, before returning to application code. It never awaits reentrant requests while a valid customer lock is held. A bulk transaction implementation need not call that hook and is still tested by the initial sixteen requests.
- Each race checks nonnegative lots, reported points ≤ initial balance, reported points == actual removal, integer-cent quote arithmetic, and GET quote consistency per successful order. Insufficient balance may reject with any 4xx or partially fulfil.
- A four-lot redemption of 600 points is cancelled exactly when its first two lots have expired; the remaining original lots are restored, expired shares forfeited, and a second cancellation cannot add anything. A separate case checks all-expired forfeiture.
- Failure sources are the base's public pricing behavior (unknown region, unknown discount, removal via the exported `configureTaxRates` operations hook). A thrown router error or a 4xx/5xx failure response is accepted; exact error wording/middleware is not required. Every lot and expiry must remain unchanged, and a distinct recovery order must remain redeemable. No particular store write API is required, so implementations with added bulk transactions are not penalized for bypassing `saveLot` fault injection.
- Auth rejections have successful controls. Another customer's replay requires 403/404 and cannot include a stored quote; unspecified diagnostic fields on errors are not constrained. Tax configuration is restored in `finally`; fixtures reset defaults.
- Date-only mocks and `deps.now` always agree. Tests are sequential within their file. No wall-clock-year assumptions, equal-expiry tie-breaking, global key scope, second fresh-key policy on the same order, malformed-body policy, or replay-after-cancel policy is asserted.
- The counter measures API-visible records and calls, not private memory accesses inside a store method. An added filtered query may pass the budget even if internally scanning private storage; the rubric explicitly retains source review of the index/query and its maintenance. The tests do not claim to prove arbitrary algorithmic complexity or every possible injected-store failure.
