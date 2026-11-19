SECOND BATCH. Apply exactly the instructions below (the same ones used for the first batch) to the results in the current directory, which holds 2 new anonymised results. Write their verdicts under `~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts/batch-2/<id>/`.

Then produce ONE combined ranking over this ranking set of 7 ids: the 2 new ones here plus r-3581b3, r-3790dc, r-16090e, r-3c1b09, r-86b4ee. The first-batch verdicts are in `~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts/<id>/verdict.json`, and their trees, diffs and reports are in `~/forge-evidence/pi-atdd/plt-82-evaluator-work/<id>/` (read only). Ignore any first-batch id that is not in the ranking set. Re-check comparisons where needed so that all 7 are judged on one scale. Write `~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts/batch-2/ranking.json` = { ranking: [{ rank, id, overall, reason }], notes } covering exactly these 7 ids, and say in `notes` that the ranking was built in two batches.

--- instructions used for the first batch (where they say "7 results", read "2 results" for the per-result part) ---

You are the blind EVALUATOR for the LOY-002 experiment. Earlier, in a separate session, you (the evaluator role) wrote hidden tests, a store-call counter, a runner and a rubric in `~/forge-evidence/pi-atdd/plt-82-evaluator` (read-only; MANIFEST.json lists its files). Read `~/forge-evidence/pi-atdd/plt-82-evaluator/TASK.md`, `~/forge-evidence/pi-atdd/plt-82-evaluator/rubric.md`, `~/forge-evidence/pi-atdd/plt-82-evaluator/hidden/` and `~/forge-evidence/pi-atdd/plt-82-evaluator/run-hidden.mjs` first.

The current directory holds 7 anonymised, immutable coder results, one directory per opaque id (`r-xxxxxx/`):
- `tree/` — the full result repository (identifiers that could reveal who produced it are replaced by `[REDACTED]`; ignore those markers),
- `result.diff` — the diff against the base (same redaction),
- `report.md` — the coder's final report (same redaction).
You do not know which model produced which result, and you must not try to find out.

For EACH result:
1. Run `node ~/forge-evidence/pi-atdd/plt-82-evaluator/run-hidden.mjs <id>/tree ~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts/batch-2/<id>/` (it copies the tree; never modify `tree/`). Read the produced `hidden-result.json` and `hidden.log`.
2. Read the diff and the relevant source. Score every rubric criterion (0–3) with a one-line justification grounded in code or test evidence, and compute the overall score as the rubric defines. Record, per trap (T-ORDER, T-LOTS, T-IDEM, T-RACE, T-REVERSAL, T-AUTH, T-PENDING, T-CLOCK), whether it is handled (yes / partial / no) with the evidence. Note store-call counts. Check report honesty against what the diff and tests actually show.
3. Write `~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts/batch-2/<id>/verdict.json` = { id, hiddenTests: {countedPass, countedTotal}, traps: {...}, rubric: {criterion: {score, why}}, overall, storeCalls, reportHonesty: {score, why}, summary }.

Then rank all 7 (1 = best) by overall quality on this multi-constraint task — correctness under the traps first, then efficiency, layering and honesty — and write `~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts/batch-2/ranking.json` = { ranking: [{ rank, id, overall, reason (one or two sentences) }], notes }. Ties are allowed only if truly indistinguishable; say why.

Write only under `~/forge-evidence/pi-atdd/plt-82-evaluator-verdicts/batch-2/`. Do not modify anything else. Finish with the ranking table.
