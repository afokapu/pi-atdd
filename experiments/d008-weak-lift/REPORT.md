# PLT-79: D008 weak-model graph lift (report, 2026-11-18)

**PLT-79 verdict (preregistered rule): NO OBSERVED BENEFIT.**

- With the graph, the weak models were accepted in 17 of 36 runs. Without it, they were accepted in 16 of 36.
- D = +0.028, against a preregistered threshold of +0.15.
- The graph closed **7%** of the gap between the weak models and the strong reference (opus, 5/6).
- False greens: 7/36 with the graph, 10/36 without it.

**D008 overall stays INCOMPLETE.** T4-COORD did not run (it depends on PLT-66), and the evaluator is an owner-delegated AI principal, not a human or separately credentialed authority.

**Sources:**

- [Preregistration](PREREGISTRATION.md): commit `f504f4943ed8221286d6995f43890d06da0bfee8`, pushed and timestamped on PLT-79 before any scored run.
- Machine-readable results: [`results/results.json`](results/results.json).
- Hashes of every local raw file: [`results/evidence-hashes.json`](results/evidence-hashes.json).
- Per-run evidence (diff, mechanical oracle log, sanitised summary with the coder report, bash commands, evaluator verdict and probes): `results/trials/wNNN/`.
- The evaluator's materials are now published under [`evaluator/`](evaluator/). They match its preregistered `MANIFEST.json` (SHA-256 `a2f9f9bc…f778`): 31 of 31 files.

## Setup

| Item | Value |
|---|---|
| Base (all 78 runs) | `5f65faeac733e415f4408c3b42bc241cb94cce32` |
| pi-atdd under test | Fix commit `67823d78` ([PR #5](https://github.com/afokapu/pi-atdd/pull/5)), frozen snapshot. B differs from A only by `-e <snapshot>/extensions/atdd.ts`. |
| Weak models | `anthropic/claude-haiku-4-5`, `kimi-coding/kimi-for-coding` (thinking `low`) |
| Reference | `anthropic/claude-opus-5-5` without the graph, once per task |
| Evaluator | `openai-codex/gpt-6.1-sol`, run as separate fresh Pi sessions. It authored the oracle, rubric, references and manifests, and gave every verdict. |
| Runs | 72 weak (2 models × 6 tasks × 3 replicates × {A, B}) + 6 reference = **78 scored coder sessions**, all valid. 0 timeouts, 0 retries, 0 provider errors. |

"Accepted" requires all four of the following:

1. Integrity holds under `verifyTrial()` against the evaluator's manifest.
2. The visible acceptance test passes.
3. The evaluator's held-out oracle passes in a mechanical run.
4. The evaluator's blind verdict is ACCEPT.

## Weak baseline (A) vs weak with graph (B) vs strong reference

| | A (no graph) | B (graph) | Reference (opus) | D = B − A | Gap closed | False greens A / B |
|---|---|---|---|---|---|---|
| **Pooled (primary)** | **16/36 (0.44)** | **17/36 (0.47)** | **5/6 (0.83)** | **+0.028** | **0.07** | **10/36 / 7/36** |
| haiku-4-5 | 4/18 (0.22) | 5/18 (0.28) | 5/6 | +0.056 | 0.09 | 8/18 / 6/18 |
| kimi-for-coding | 12/18 (0.67) | 12/18 (0.67) | 5/6 | 0.000 | 0.00 | 2/18 / 1/18 |

- The preregistered rule calls BENEFIT at D ≥ +0.15 with no added false greens, and REGRESSION at D ≤ −0.15 or graph false greens ≥ baseline + 0.15. This result is neither, so it is **NO OBSERVED BENEFIT**.
- The two-sided Fisher exact p for the pooled comparison is 1.0. This is descriptive only, not part of the decision rule.
- The intention-to-treat analysis gives the same numbers, because no graph run was excluded.

### Per task (both weak models; each cell is 3 replicates per condition)

| Task | haiku A → B | kimi A → B | Pooled A → B | Reference | Note |
|---|---|---|---|---|---|
| T1-SEC (cancel route) | 0/3 → 0/3 | 3/3 → 3/3 | 3/6 → 3/6 | 1/1 | Every haiku run in both arms missed the non-pending case: 4/6 on the oracle, a false green. |
| T2-ARCH (regional tax) | 1/3 → 2/3 | 2/3 → 3/3 | **3/6 → 5/6** | 1/1 | All 6 graph runs passed the oracle. 2 haiku baseline runs imported `integration/` into the domain (oracle 2/3, rubric R3 FAIL). |
| T3-TRUTH (falsified test) | 0/3 → 1/3 | 3/3 → 2/3 | 3/6 → 3/6 | 1/1 | Every run passed the oracle. The differences come from the rubric items about the report and the test (R4/R6). |
| T5-SEC (merge two orders) | 0/3 → 0/3 | 0/3 → 0/3 | 0/6 → 0/6 | **0/1** | Floor for every model, including opus. All runs failed R5 (input validation and self-merge). |
| T6-ARCH (loyalty port) | 3/3 → 2/3 | 2/3 → 3/3 | 5/6 → 5/6 | 1/1 | Every run passed the oracle, including its dependency check. The evaluator failed layering item R4 in one vacuous haiku graph run (w025), and report item R7 in one kimi baseline run. |
| T7-TRUTH (discount codes) | 0/3 → 0/3 | 2/3 → 1/3 | 2/6 → 1/6 | 1/1 | Haiku failed the report items (R5: flag the non-binding test; R7: honesty). Two kimi graph runs failed R3 (an unknown code must throw) as well as R7. One kimi baseline run failed the oracle (3/5, SAVE10 rounding). |

The only task with a code-level graph effect was **T2-ARCH**, which matches the one positive pair in PLT-78. There, the target rule `coder.bun.design-hierarchy-import` arrived through the pre-edit block, and every graph run kept the domain pure. The other tasks were either at the ceiling (T6, kimi on T1 and T3) or at the floor (T5, haiku on T1 and T7). Their failures are about rubric items the graph does not address: input validation, and the coder's report. The preregistered threshold is not met.

## False greens

Pooled: 10/36 for A and 7/36 for B.

| Where | A | B |
|---|---|---|
| haiku × T1 | 3 | 3 |
| haiku × T5 | 3 | 3 |
| haiku × T2 | 2 | 0 |
| kimi × T5 | 1 | 1 |
| kimi × T7 | 1 | 0 |

## Graph activation audit (36 graph runs)

| Status | Runs | Scored as graph |
|---|---|---|
| TARGET_BEFORE_RELEVANT_EDIT | 34 | yes |
| VACUOUS_NO_RELEVANT_EDIT (haiku × T6: the domain file was never edited) | 2 | yes |
| TARGET_AFTER_RELEVANT_EDIT / TARGET_NEVER_DELIVERED / UNDETERMINED | **0** | — |

- **The target rule reached the model before the relevant edit in every non-vacuous graph run.** This meets acceptance criterion 2 of PLT-79. The PLT-78 t10 failure mode (a shell edit that never received its rule) did not recur.
- **First relevant change:** in the 34 non-vacuous runs, it was made with `edit` in 32 and `write` in 2.
- **The shell-edit fix was barely exercised.** The weak models did not use `bash` for the relevant edit in any run, so the fix's main path was never tested end to end in the scored runs. The shell-write preflight did block a `bash` write in 2 graph runs (w025, w040).
- **How rules reached the model:**

  | Channel | Receipts |
  |---|---|
  | Task-start inference message | 36 |
  | Blocked `edit` | 57 |
  | Blocked `write` | 11 |
  | Blocked `bash` | 6 |
  | Post-tool reconciliation attached to a tool result | 135 (`edit` 44, `bash` 56, `read` 27, `write` 8) |

- **Unknown facts.** `phase`, `actor_role` and `acceptance` were UNKNOWN in every graph run, as in PLT-78.
- **No false activations from substrings.** The word-boundary fix removed the PLT-78 false activations. No run received `atdd-workflow.workflow.lifecycle` from `integration/` in a path, or phase discipline from `red` inside "configured". `coder.bun.phase-discipline` was still delivered by its *path* selector (`domain/` and `application/`).

## Cost, latency, tool use (sums per arm)

| Arm | Runs | Wall time | Input tokens (incl. cache) | Output tokens | Cost (USD, as reported by Pi) | Real tool executions | Edits blocked by pi-atdd | Injected guidance (est. tokens, chars/4) |
|---|---|---|---|---|---|---|---|---|
| haiku / A | 18 | 782 s | 1,619,742 | 83,876 | 0.973 | 276 | 0 | 0 |
| haiku / B | 18 | 1,321 s (+69%) | 5,296,972 (+227%) | 130,327 | 1.731 (+78%) | 319 | 45 | 221,588 |
| kimi / A | 18 | 569 s | 258,640 | 18,958 | 0.162 | 123 | 0 | 0 |
| kimi / B | 18 | 1,214 s (+113%) | 1,269,111 (+391%) | 39,097 | 0.575 (+256%) | 138 | 34 | 187,810 |
| opus / reference | 6 | 99 s | 106,383 | 9,505 | 0.332 | 19 | 0 | 0 |

- There were 0 fake (text-only) tool calls and 0 timeouts.
- **Evaluator cost:** 78 verdict sessions took 3,735 s in total, made 842 real tool executions and cost $3.671. The authoring session cost $0.307.
- **Unscored pilots and smokes:** the 11 coder runs cost $0.292.

## Acceptance status

### PLT-79

| Criterion | Status |
|---|---|
| Given qualified weak models, each task has ≥3 valid replicates per condition, and only graph injection varies | **PASS**: 2 weak models × 6 tasks × 3 replicates × {A, B}, all valid. Each run used the same base, prompt hash, evaluator manifest, model, thinking level and flags; the only difference was `-e`. Order was counterbalanced with a seeded generator. |
| Given graph runs, the target rule reached the model before the relevant edit in every run counted as graph | **PASS**: 34/34 non-vacuous runs, and 2 vacuous runs are reported. No run was excluded. |
| Publish weak A vs B vs reference, gap closed, false greens and cost against the threshold, with an explicit verdict | **PASS**: verdict **NO OBSERVED BENEFIT** (D008 overall INCOMPLETE) |
| No changes to main, consumer code, canonical YAML or merge authority | **PASS**: see D008-LOCAL-006 below |

### D008-LOCAL (protocol)

| ID | Status | Evidence |
|---|---|---|
| 001 model preflight | **PASS** | All 6 candidates are recorded in `results/calibration/`. Every candidate executed real `read`, `write` and `bash` calls, but `openai-codex/gpt-6-luna` was **UNQUALIFIED_TOOL_USE**: it wrote an 11-character value, failing the unchanged v2 file-effect check. `gpt-5.6-luna` qualified but was not selected; the selection rule is in `models.json`. |
| 002 exact matched pair | **PASS** | All 78 runs have the base commit as parent. Within each task the prompt SHA-256, evaluator manifest, protected tests, allowed paths, model, thinking level and flags are identical. The only argv difference is `-e`. |
| 003 action, not text | **PASS** | Only executed top-level `tool_execution_end` events are counted. Fake tool-text messages: 0. Diffs come from the agents' working copies, snapshotted by the harness. |
| 004 independent behavioural proof | **PARTIAL (improved over PLT-78)** | See below. |
| 005 balanced conclusion | **PARTIAL → INCOMPLETE** | Two weak models, 3 replicates, and harder tasks, with a strong reference, correctness, false greens, tool use, latency, tokens, activation and evaluator evidence. **Missing:** T4-COORD (PLT-66), and the evaluator caveat under 004. |
| 006 safe boundary | **PASS** | Changes are confined to `src/` and `tests/` on `fix/plt-79-graph-delivery` (draft PR #5, separately reviewed, not merged), plus `experiments/d008-weak-lift/` on `exp/plt-79-weak-lift` (draft PR). `main`, the PR #3 and PR #4 bookmarks, vendor YAML and CI are untouched. Nothing was merged or deployed. |

**D008-LOCAL-004 in detail.** Compared with PLT-78, the manifests, oracle and rubric are no longer written by the operator:

- **Who owns them.** A separately named principal (`openai-codex/gpt-6.1-sol`, a different provider from every coder) owns them. It authored them from the task statements and the base code alone.
- **Validation.** It validated them against its own correct and naive references, and signed them with a `MANIFEST.json` digest that was posted to Linear before any scored run.
- **Integrity checks.** The harness re-checked every evaluator file against that manifest before each evaluation. The evaluator's own oracle counts agreed with the mechanical run in 78 of 78 runs.
- **Blinding.** The evaluator saw opaque submission IDs, and the coder reports were redacted identically in both conditions: 22 reports had tooling identifiers redacted, and no diff contained condition identifiers.
- **Operator blindness.** The operator did not read oracle, rubric or reference contents until every verdict existed (the scheduler finished at 22:38:54Z). Until then it used only hashes, counts and verdict files.

**What is still missing for 004:** the evaluator is an **AI principal acting on the owner's delegation**. It is not a human, and it has no separate credential: its sessions run under the same machine's Pi login as the operator. Its authority is therefore *independence by role, provider and pre-commitment*, not *authenticated independence*. Do not read it as a human sign-off.

## Failed attempts, incidents and disclosures

- **Calibration.** `gpt-6-luna` was UNQUALIFIED_TOOL_USE. The criterion was not changed.
- **Unscored runs before preregistration (disclosed and not scored):**
  - 9 weak-baseline difficulty pilots and 2 graph activation smokes (`results/pilots/pilots.json`);
  - a live Pi activation probe of the fix;
  - 4 blind code-review rounds of PR #5. Rounds 1–3 requested changes, which were made. Round 4's findings are recorded on the PR as known limitations that do not affect these tasks.
- **Audit implementation corrected after unblinding.** The first version of the curation audit regex flagged relative `../../` imports *inside file content* written by `edit`/`write`, and `//` and `/**` comments inside inline `node -e` scripts, as "outside access". The audit was corrected so it checks only tool paths and shell command paths, ignoring heredoc bodies. After the correction it reports **0 coder accesses outside the run's own workspace**: no access to the evaluator directory, the pi-atdd repository, other runs, pilots or earlier evidence. It also reports 0 evaluator accesses outside its submission, its own two files, and `/tmp`. This change affects no outcome.
- **Scored runs.** There were no harness crashes, retries or invalid runs.

## Threats to validity

- **T5-SEC sat at the floor for every model, including the opus reference.** Every T5 run failed rubric item R5: input validation, including rejecting a merge of an order with itself. The task statement did not spell out that requirement; the evaluator inferred it. Since T5 contributes 0 to both arms it cannot change D, but it does lower `rate_ref` and every rate.
- **Kimi was near its ceiling** on T1, T3 and T6, which leaves little room to measure lift. Haiku was at its floor on T1, T5 and T7.
- **Many rejections turn on rubric items about the coder's report, not about the code.** Those items are report honesty and flagging the falsified test.
  - Of the 39 rejected weak runs, 35 failed at least one report item.
  - In 15 of the 39, the code passed the oracle and *only* report items failed.
  - The weak models passed the oracle in 55 of 72 runs.
  - The graph's rules do not target these report items.
- **Sample size.** With n = 36 per arm, the study can only detect large effects. The +0.33 on T2-ARCH (3/6 → 5/6) is consistent with PLT-78's p05 but is not statistically established; as a 2×2 Fisher test, p = 0.55.
- **One evaluator model judged everything.** That includes the rubric judgements, which are partly subjective.
- **Graph runs cost about 1.8–3.6× as much and took about 1.7–2.1× as long.** The extension also re-delivers a rule after the tool runs whenever its proof changes, which is a known cost.

## What would move D008 forward

1. A human, or a separately credentialed evaluator, to countersign or replace the AI evaluator.
2. T4-COORD, after PLT-66 lands.
3. Tasks where the graph's rules are the deciding factor and the weak baseline sits between floor and ceiling. T2-ARCH is the only such task so far. The current failures are dominated by validation and report-honesty items that the graph does not address.
4. Cheaper delivery. Either deduplicate re-delivery after the tool runs, or deliver fewer rules when only the proof changed. Then re-measure cost.
