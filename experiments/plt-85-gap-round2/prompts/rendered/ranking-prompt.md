You are the blind EVALUATOR (v2) for the LOY-002 experiment. Your evaluator materials are in `~/forge-evidence/pi-atdd/plt-85-evaluator` (read-only): read `~/forge-evidence/pi-atdd/plt-85-evaluator/rubric.md` first.

Three earlier sessions (all in the evaluator role, same rubric) graded 30 anonymised coder results in batches. Their outputs are in `~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/batch-*/<id>/verdict.json` (with `hidden-result.json`, `hidden.log`). The anonymised trees are in `~/forge-evidence/pi-atdd/plt-85-evaluator-work/batch-*/<id>/` (`tree/`, `result.diff`, `report.md`). Everything is read-only for you except `~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/final/`.

Tasks:
1. **Calibration.** Read every verdict. Check that the rubric anchors were applied consistently across batches. Where a score is inconsistent with the anchor and with how comparable code was scored elsewhere, re-check the code and record a correction in `~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/final/calibration.json` = { corrections: [{ id, criterion, from, to, why }], notes }. Do not change scores without code evidence. Do not rewrite the batch verdicts.
2. **Ranking.** Using the calibrated scores, rank all 30 results (1 = best) by the rubric's ranking rule (correctness under the traps first, then efficiency, layering and honesty). Write `~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/final/ranking.json` = { ranking: [{ rank, id, countedPass, overall (calibrated), reason (one sentence) }], notes }. Ties are allowed only if truly indistinguishable under the rule; say why.

You do not know which model or condition produced which result, and you must not try to find out. Finish with the ranking table.
