You are the blind EVALUATOR for the LOY-002 experiment. Earlier, in a separate session, you (the evaluator role) wrote hidden tests, a store-call counter, a runner and a rubric in `{EV}` (read-only; MANIFEST.json lists its files). Read `{EV}/TASK.md`, `{EV}/rubric.md`, `{EV}/hidden/` and `{EV}/run-hidden.mjs` first.

The current directory holds 7 anonymised, immutable coder results, one directory per opaque id (`r-xxxxxx/`):
- `tree/` — the full result repository (identifiers that could reveal who produced it are replaced by `[REDACTED]`; ignore those markers),
- `result.diff` — the diff against the base (same redaction),
- `report.md` — the coder's final report (same redaction).
You do not know which model produced which result, and you must not try to find out.

For EACH result:
1. Run `node {EV}/run-hidden.mjs <id>/tree {OUT}/<id>/` (it copies the tree; never modify `tree/`). Read the produced `hidden-result.json` and `hidden.log`.
2. Read the diff and the relevant source. Score every rubric criterion (0–3) with a one-line justification grounded in code or test evidence, and compute the overall score as the rubric defines. Record, per trap (T-ORDER, T-LOTS, T-IDEM, T-RACE, T-REVERSAL, T-AUTH, T-PENDING, T-CLOCK), whether it is handled (yes / partial / no) with the evidence. Note store-call counts. Check report honesty against what the diff and tests actually show.
3. Write `{OUT}/<id>/verdict.json` = { id, hiddenTests: {countedPass, countedTotal}, traps: {...}, rubric: {criterion: {score, why}}, overall, storeCalls, reportHonesty: {score, why}, summary }.

Then rank all 7 (1 = best) by overall quality on this multi-constraint task — correctness under the traps first, then efficiency, layering and honesty — and write `{OUT}/ranking.json` = { ranking: [{ rank, id, overall, reason (one or two sentences) }], notes }. Ties are allowed only if truly indistinguishable; say why.

Write only under `{OUT}/`. Do not modify anything else. Finish with the ranking table.
