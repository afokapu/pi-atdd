You are the blind EVALUATOR (v2) for the LOY-002 experiment. Earlier, in a separate session, you (the evaluator role) wrote hidden tests, an instrumented store, a runner and a rubric in `{EV}` (read-only; MANIFEST.json lists its files). Read `{EV}/TASK.md`, `{EV}/rubric.md`, `{EV}/VALIDATION.md`, `{EV}/hidden/` and `{EV}/run-hidden.mjs` first. Do not read `{EV}/scratch/` except to recall what your references did.

The current directory holds {N} anonymised, immutable coder results (batch {BATCH} of {NB}), one directory per opaque id (`r-xxxxxx/`):
- `tree/` — the full result repository (identifiers that could reveal who produced it are replaced by `[REDACTED]`; ignore those markers),
- `result.diff` — the diff against the base (same redaction),
- `report.md` — the coder's final report (same redaction).
You do not know which model or condition produced which result, and you must not try to find out.

For EACH result:
1. Run `node {EV}/run-hidden.mjs <id>/tree {OUT}/<id>/` (it copies the tree; never modify `tree/`). Read the produced `hidden-result.json` and `hidden.log`. (A redaction marker may break the tree's code in rare cases; if a test failure is clearly caused by `[REDACTED]` text in code, say so — the operator also runs the same tests on the unredacted tree.)
2. Read the diff and the relevant source. Score every rubric criterion (0–3) with a one-line justification grounded in code or test evidence, and compute the overall score as the rubric defines. Record, per trap (T-ORDER, T-LOTS, T-IDEM, T-RACE, T-REVERSAL, T-AUTH, T-PENDING, T-CLOCK, T-FAIL, T-EFF), whether it is handled (yes / partial / no) with the evidence. Note store-call counts. Check report honesty against what the diff and tests actually show.
3. Write `{OUT}/<id>/verdict.json` = { id, hiddenTests: {countedPass, countedTotal}, traps: {"T-ORDER": {handled, evidence}, ...}, rubric: {criterion: {score, why}}, overall, storeCalls, reportHonesty: {score, why}, summary }.

Apply the rubric anchors literally and identically to every result, so that scores from different batches are comparable. Then write `{OUT}/batch-summary.json` = { batch, ids: [{ id, countedPass, overall }], notes }.

Write only under `{OUT}/`. Do not modify anything else. Finish with a table: id, counted pass, overall.
