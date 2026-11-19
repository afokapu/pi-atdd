# Frozen evaluator validation

Only TASK.md and the base README/src/tests (plus its package metadata) were inspected as task inputs. No coder solution was inspected. `base/` was not edited. Runtime: Node v26.4.0, no dependencies installed.

## Artifacts

- `hidden/acceptance.test.ts`: 16 counted public-API acceptance tests, one informational efficiency test.
- `hidden/store-counter.ts`: product-store instrumentation, including added prototype methods.
- `hidden/cases.json`: fixed catalog for import-failure accounting.
- `run-hidden.mjs`: isolated copy, 120-second timeout, JSON results and full TAP log.
- `rubric.md`: ten anchored 0–3 criteria, scoring and ranking rules.
- `scratch/reference/`: private, deliberately straightforward reference implementation (not an efficiency exemplar).
- `scratch/validate-variants.mjs`, `scratch/variants/`: reproducible mutation checks and retained mutated trees.
- `scratch/validation/`: individual logs, JSON results, store-call files, retained run copies and `variants-summary.json`.
- `scratch/direct/`: direct execution of the exact quoted test-glob command, without runner-specific environment variables; includes `evaluator-hidden/store-calls.json`.

## Counted coverage

| Trap | Count |
|---|---:|
| T-ORDER | 3 |
| T-LOTS | 1 |
| T-IDEM | 2 |
| T-RACE | 2 |
| T-REVERSAL | 2 |
| T-AUTH | 2 |
| T-PENDING | 2 |
| T-CLOCK | 2 |
| **Total** | **16** |

T-EFFICIENCY has one **non-counting** test. No unspecified-behavior tests contribute to the verdict.

## Results on final hidden files

- Base: **0/16 counted**, all 17 tests fail, runner completes normally and writes JSON/logs. Positive controls ensure missing routes do not accidentally pass auth/state/idempotency rejection checks.
- Reference: **16/16 counted**, informational measurement passes. Original base tests: **9/9 pass**.
- Direct command in `scratch/direct/`: `node --test "evaluator-hidden/*.test.ts"` gives **17/17 pass**, with a measurement JSON file.
- Renamed/nested quote-field variant: **16/16 counted**. This demonstrates tolerance of case, suffix and response-envelope changes.
- System-clock-only variant (ignores `deps.now`): **16/16 counted**. Date mocking accommodates both permitted time sources.

| Deliberately wrong variant | Counted passes | Intended detection |
|---|---:|---|
| Tax before points | 14/16 | T-ORDER |
| No discounted-amount cap | 14/16 | T-ORDER |
| Latest-expiry first | 13/16 | T-LOTS |
| Expired lots allowed | 13/16 | T-CLOCK (also lots) |
| No idempotency lookup | 14/16 | T-IDEM |
| No body-mismatch check | 15/16 | T-IDEM |
| No customer lock | 14/16 | T-RACE |
| Refund into new lot identities | 14/16 | T-REVERSAL |
| Refund expired allocations | 15/16 | T-REVERSAL |
| Ignore ownership | 15/16 | T-AUTH |
| Ignore session | 14/16 | T-AUTH |
| Ignore pending status | 14/16 | T-PENDING |
| Fixed/stale clock | 13/16 | T-CLOCK |
| Syntax error in app import | 0/16 | All cases reported failed, no runner crash |

Every mutation was detected by at least one intended counted trap. The no-lock variant reports 800 points applied from a 500-point balance and 1,500 from 611 in the two races; these are meaningful double-spend failures, not timeout/import failures. Full assertions remain in each `hidden.log`.

## Reference measurements (not an acceptance target)

For each fresh 150-point redemption, the reference calls `lotsFor` once and `saveLot` twice: three calls, 1,240 observed lots read, two lots written. Identical replay uses zero loyalty-store calls. This exposes the reference's full-history rescan, which should not receive top efficiency marks despite functional correctness.

## Reproduction

```
node run-hidden.mjs base scratch/validation/base
node run-hidden.mjs scratch/reference scratch/validation/reference
node --test "scratch/reference/tests/**/*.test.ts"
node scratch/validate-variants.mjs
```

The runner retains temporary result copies for inspection and never modifies its submitted input. All scratch files and validation evidence are intentionally retained, but excluded from the frozen-file manifest as requested.
