# PLT-78 — D008 local Pi graph-vs-baseline experiment: REPORT (2026-11-18)

**Verdict: D008 INCOMPLETE.** The preregistered rule gives a directional result of **NO OBSERVED BENEFIT**: net accepted-pair delta **0** over 6 valid pairs, with false greens graph 1 vs baseline 2.

[Preregistration](PREREGISTRATION.md) (commit `9fb246b1c23e568a5291f08815973ef36b1c9d8c`) was pushed before any scored trial. Machine-readable results: [`results/pairs.json`](results/pairs.json). Hashes of the local raw files: [`results/evidence-hashes.json`](results/evidence-hashes.json). Per-trial curated evidence (diff, oracle log, sanitised summary, reviewer record) is in `results/trials/tNN/`. The held-out oracle and the reference solutions are published under [`oracle/`](oracle/) and [`reference/`](reference/) now that all trials have finished. Their SHA-256 digests match the preregistered values.

## Paired results

Base for every trial is `549185b97af28a62f6ee8b3dc69fcfce59562d15`. Coders ran on `anthropic`; the blind reviewer was `openai-codex/gpt-6.1-sol`. "Accepted" requires all four of: integrity, visible test, held-out oracle, and reviewer ACCEPT.

| Pair | Tier / model | Task | Baseline (trial: oracle, reviewer → accepted) | Graph (trial: oracle, reviewer → accepted) | Δ | False green B / G |
|---|---|---|---|---|---|---|
| p01 (smoke) | weak / claude-haiku-4-5 | T1-SEC | t03: 6/7, REJECT → **no** | t05: 6/7, REJECT → **no** | 0 | yes / yes |
| p05 | weak | T2-ARCH | t04: 5/6 (domain imports integration), REJECT → **no** | t07: 6/6, ACCEPT → **yes** | **+1** | yes / no |
| p03 | weak | T3-TRUTH | t02: 3/3, ACCEPT → **yes** | t01: 3/3, REJECT (R3: report did not flag the falsified test) → **no** | **−1** | no / no |
| p06 | strong / claude-opus-5-5 | T1-SEC | t06: 7/7, ACCEPT → **yes** | t08: 7/7, ACCEPT → **yes** | 0 | no / no |
| p02 | strong | T2-ARCH | t12: 6/6, ACCEPT → **yes** | t10: 6/6, ACCEPT → **yes** | 0 | no / no |
| p04 | strong | T3-TRUTH | t09: 3/3, ACCEPT → **yes** | t11: 3/3, ACCEPT → **yes** | 0 | no / no |

Accepted totals: baseline 4/6, graph 4/6, net 0. The preregistered rule reads: BENEFIT requires net ≥ +2, and REGRESSION requires net ≤ −2 or graph false greens ≥ baseline + 2. This result is neither, so it is **NO OBSERVED BENEFIT**.

Observations, which are not claims:
- **Strong model:** both conditions were accepted on all 3 tasks, so the graph had no measurable effect at this difficulty.
- **Weak model, T2:** this is the only pair where the graph produced a code-level difference. The baseline imported `integration/tax-rates.ts` into the domain, which violates `coder.bun.design-hierarchy-import`. The graph arm received that rule through the pre-edit block and injected the rate from the application layer.
- **Weak model, T3:** both arms produced code that passed the oracle. The −1 comes entirely from rubric item R3: the reviewer judged that the graph arm's *report* did not flag the falsified SHP-001 test, while the baseline report did.
- **Weak model, T1:** both arms added authentication and ownership checks, and both missed the shipped-order case (an uncaught domain error instead of a 4xx). Both reports claimed success, so both count as false greens.

## Cost, latency, tool use (sums per arm, 3 trials each)

| Arm | Wall time | Real Pi tool executions | Edits blocked by pi-atdd | Input tokens (incl. cache) | Output tokens | Cost (USD, as reported by Pi) | Injected guidance (est. tokens, chars/4) |
|---|---|---|---|---|---|---|---|
| weak / baseline | 114 s | 37 | 0 | 182,557 | 11,643 | 0.136 | 0 |
| weak / graph | 214 s (+87%) | 46 | 6 | 541,968 (+197%) | 21,401 | 0.274 | 24,696 |
| strong / baseline | 50 s | 12 | 0 | 59,739 | 4,350 | 0.153 | 0 |
| strong / graph | 68 s (+35%) | 14 | 2 | 156,709 (+162%) | 5,891 | 0.340 | 16,350 |

There were zero fake (text-only) tool calls. The tool counts include only top-level `tool_execution_end` events that actually executed (`durationMs` present). Harness commands (`jj commit`, evaluator test runs) are excluded. Retries: no provider auto-retries occurred, and no trial timed out. The 8 blocked edits in the graph arms are pi-atdd's intended "read guidance, then retry" preflight.

## Graph activation

- The target rule was delivered before the first successful edit in 5 of 6 graph trials.
- **t10 (strong, T2-ARCH): the target rule was never delivered.**
  - Opus wrote files with `bash` heredocs, so the pre-edit `tool_call` hook never fired.
  - The post-tool observer did notice the change. But within its 4,500-character page it re-emitted only `atdd-workflow.workflow.lifecycle`, not `coder.bun.design-hierarchy-import`.
  - The strong model got the architecture right anyway.
  - This is a real enforcement gap for shell-editing agents.
- Irrelevant activations came from substring term matching:
  - `atdd-workflow.workflow.lifecycle` fired on the term `integration/` (because of the `src/pricing/integration/` path in the T2 prompt).
  - `coder.bun.phase-discipline` fired on the term `red` inside ordinary words.
  - The T3 guidance for `tester.bun.acceptance-binding-declared` mostly concerns URN headers. It is only indirectly about a test asserting unrelated behaviour.
- `phase`, `actor_role` and `acceptance` facts were UNKNOWN in every graph trial. Every receipt reported 44 unresolved external edges ("completeness NOT established").

## Acceptance status

| ID | Status | Evidence |
|---|---|---|
| D008-LOCAL-001 model preflight | **PASS** | All 5 candidates produced real read/write/bash `tool_execution_*` events and the file effect (`results/calibration/`). claude-haiku-4-5 wrote an incorrect value; this was recorded as a competence error, not a tool-use failure. No model was `UNQUALIFIED_TOOL_USE`. |
| D008-LOCAL-002 exact matched pair | **PASS** | All 12 trials have parent = the base commit. Within each task the prompt SHA-256, manifest digest, protected tests, allowed paths, model, thinking level and Pi flags are identical. The only argv difference is `-e <frozen extension snapshot>`. Condition order was counterbalanced with a seeded PRNG. Every session was fresh (`--no-session`). |
| D008-LOCAL-003 action, not text | **PASS** | Only executed Pi tool events are counted. Fake-tool-text messages: 0. Diffs come from the agents' working copies, snapshotted by the harness. |
| D008-LOCAL-004 independent behavioural proof | **PARTIAL → INCOMPLETE** | `verifyTrial()` re-ran the protected tests on the immutable result revisions (clean tree, exact HEAD, base ancestor, allowlist; a tampered-test reference was rejected). A held-out oracle ran on exported trees. A blind reviewer on a different provider ran its own behavioural probes (6–12 real tool executions per review). **Missing:** an independently authenticated evaluator authority. Manifests, oracle and rubric were written by the operator agent and are only pinned by the preregistration commit. The reviewer is authenticated only through the same operator's Pi login. |
| D008-LOCAL-005 balanced conclusion | **PARTIAL → INCOMPLETE** | Weak and strong pairs are reported with correctness, false greens, tools, latency, tokens, activation and reviewer evidence against the preregistered threshold. **Missing:** T4-COORD did not run (it depends on PLT-66: no JJ exact-head validator is available to the agent), there is only one replicate per pair, and the evaluator authority above is missing. |
| D008-LOCAL-006 safe boundary | **PASS** | The only change is `experiments/d008-local/` on `exp/plt-78-d008-local-20261118` (draft PR). `main`, `src/`, `extensions/`, vendor YAML, CI and PR #3 are untouched. Trials ran only in disposable repositories under the local evidence directory, and nothing was merged. |

## Failed attempts and harness incidents (preserved)

- **Calibration criterion v1:** this criterion required an exact value. claude-haiku-4-5 executed the tools but wrote a wrong value, so v1 called it unqualified. The criterion was revised to v2 *before* preregistration, and both verdicts are kept in the raw evidence.
- **Reviewer concurrency bug:** the shared JSON blind map lost entries under parallel reviews, and the t07 review crashed before spawning Pi (no reviewer session ran). The mapping was rebuilt from the per-review records, the harness was switched to one map file per trial, and the t07 review then ran once. No review was re-run.
- **Workspace access audit:** no coder or reviewer touched the evaluator, oracle, reference, other trials or the extension's canonical-source files. The reviewers' scratch probes in `/tmp` are allowed by the rubric.

## Threats to validity

- n = 6 single-replicate pairs. The one +1 and one −1 could each flip on a rerun.
- The fixture is small and synthetic, so the strong model hit a ceiling.
- One reviewer model applied one rubric. The T3 delta depends on its reading of the coder's report.
- The redaction could not hide everything: graph-arm reports were redacted the same way, and no condition identifiers leaked into any diff. Even so, graph-arm behaviour such as blocked-edit retries is visible only to the coder, not to the reviewer.

## What would complete D008

1. An independently authenticated evaluator principal that owns and signs the manifests, oracle and rubric (a human or a separately credentialed service). This is the one prerequisite that cannot be produced from inside the experiment.
2. T4-COORD after PLT-66 lands.
3. At least 3 replicates per pair, plus harder weak-tier tasks.
4. Fixes found by this run, under separate review: route shell-observed domain edits through the full applicable rule set, use word-boundary term matching in selectors, and keep the target rule within the post-tool page budget.
