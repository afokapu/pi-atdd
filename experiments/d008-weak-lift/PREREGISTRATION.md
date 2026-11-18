# PLT-79: D008 weak-model graph lift (preregistration)

This file was committed and pushed **before any scored run**. The machine-readable record is in [`prereg.json`](prereg.json), [`tasks.json`](tasks.json) and [`models.json`](models.json). The canonical protocol is [`docs/D008-OUTCOME-PROTOCOL.md`](../../docs/D008-OUTCOME-PROTOCOL.md). The harness reuses PLT-78's ([`../d008-local/`](../d008-local/)), adapted under [`harness/`](harness/).

## Hypothesis

Take a **weak** model and hold the settings, tools, task and exact base revision fixed. Comparing condition **B** (graph: the fixed `pi-atdd` extension injects source-locked graph guidance automatically) against condition **A** (no injection), B should **raise the rate of independently accepted changes**, closing part of the gap to a strong model. B should also not increase false greens.

The strong model is a reference ceiling only. It is not a tested condition.

## Fixed design

| Item | Value |
|---|---|
| Base revision (every run) | `5f65faeac733e415f4408c3b42bc241cb94cce32`: a disposable repository built from [`fixture/`](fixture/), byte-identical to that directory |
| pi-atdd under test | Fix commit `67823d789bf681698e5126f38eee4f0f998aa523` ([draft PR #5](https://github.com/afokapu/pi-atdd/pull/5)). It is frozen as a read-only `git archive` snapshot; digests are in `prereg.json.piAtdd`. The experiment pins this SHA, not a merge. |
| Pi | 1.5.2, flags `--mode json --approve --no-session --no-mcp --no-skills --no-prompt-templates --no-context-files --no-themes --no-extensions`, default built-in tools |
| Only difference between A and B | B adds exactly `-e <snapshot>/extensions/atdd.ts` |
| Weak models | `anthropic/claude-haiku-4-5` and `kimi-coding/kimi-for-coding`, both with thinking `low` |
| Reference | `anthropic/claude-opus-5-5`, thinking `low`, condition A, once per task |
| Tasks | T1-SEC, T2-ARCH, T3-TRUTH (PLT-78 task texts) plus the harder T5-SEC, T6-ARCH, T7-TRUTH. T4-COORD is **not run** and stays INCOMPLETE until PLT-66 lands. |
| Replicates | 3 per weak model × task × condition. Replicate 1's order is seeded, replicate 2 reverses it, and replicate 3 is seeded. |
| Scored coder sessions | 78 = 2 weak models × 6 tasks × 3 replicates × 2 conditions + 6 reference |
| Workspaces | One fresh `jj git clone --colocate` per run at the base, with the remote removed. The harness `jj commit` snapshots the immutable result revision. |
| Budgets | Coder 20 min, evaluator 20 min. At most 4 coder sessions and 3 evaluator sessions run concurrently, dispatched in schedule order. |

### Model qualification (D008-LOCAL-001, unscored)

The calibration and its criterion v2 are reused from PLT-78. The coder must actually execute `read`, `write`/`edit` and `bash` tool calls, the answer file must be written, and correctness is recorded separately.

| Candidate | Status |
|---|---|
| anthropic/claude-haiku-4-5 | QUALIFIED_TOOL_USE |
| kimi-coding/kimi-for-coding | QUALIFIED_TOOL_USE |
| openai-codex/gpt-6-luna (smallest openai-codex) | **UNQUALIFIED_TOOL_USE**: it executed `read`, `write` and `bash`, but wrote an 11-character value, so the file-effect check failed |
| openai-codex/gpt-5.6-luna | QUALIFIED_TOOL_USE (not selected) |
| anthropic/claude-opus-5-5 | QUALIFIED_TOOL_USE |
| openai-codex/gpt-6.1-sol (evaluator) | QUALIFIED_TOOL_USE |

**How weak model 2 was chosen.** The rule was fixed before any task outcome. Use the qualified kimi-coding candidate, so that every coder runs on a different provider from the evaluator (openai-codex). If no kimi-coding candidate qualifies, use the cheapest qualified openai-codex model instead.

## Named evaluator (prerequisite 2)

The evaluator is `openai-codex/gpt-6.1-sol`. It runs as separate fresh Pi sessions (`--no-session --no-mcp --no-context-files --no-skills --no-extensions`). It is an **owner-delegated AI principal named by the coordinator**: it is not a human, and it has no separate credential, because it runs under the operator machine's own Pi login.

It owns `plt-79-evaluator/`, which it authored from the task statements and the base code alone:

- held-out oracle tests, written fresh for every task (the PLT-78 oracle is public);
- the blind-review rubric;
- correct and naive references, with a validation table;
- the acceptance manifests (`pi-atdd/acceptance-manifest/v1`);
- `MANIFEST.json`, holding the SHA-256 of every evaluator file.

**`MANIFEST.json` SHA-256: `a2f9f9bc3731dd721c57d81104882d8b88db591ecb7657aa3014545405eff778`**

The evaluator reported this validation. For every task, the correct reference passes the visible test and the whole oracle, every naive reference fails at least one oracle test, and the unmodified base fails at least one oracle test.

**Operator blindness.** The operator does not read the oracle, rubric, references or evaluator session transcripts until every scored run and verdict exists. It uses only hashes, mechanical pass/fail counts and verdict files. Its own tool-event log is the audit of this.

**Per-run evaluation.** The harness does three mechanical steps:

1. It checks every evaluator file against `MANIFEST.json`.
2. It runs `verifyTrial()` against the evaluator's acceptance manifest.
3. It runs the evaluator's oracle on the exported result revision.

A fresh evaluator session then gives the blind verdict. It sees an opaque submission ID, the task, the diff and the coder's report, with tooling identifiers redacted identically in both conditions. It runs its own oracle and probes, and returns a verdict JSON that is stored verbatim.

## Outcome definitions (fixed before outcomes)

- **Accepted:** all four of the following hold.
  1. Integrity is valid (clean tree, exact HEAD, base ancestor, only allowed paths, evaluator manifest).
  2. The visible acceptance test passes.
  3. The held-out oracle passes in the mechanical run.
  4. The evaluator's verdict is ACCEPT.
- **False green:** the evaluator judges that the coder's report claims success, and the oracle does not pass.
- **Valid run:**
  - The run started from the exact base, made at least one real Pi tool execution, and has a parsed verdict.
  - A timeout or loop is valid and counts as not accepted.
  - A provider failure with zero tool executions is INVALID. It may be retried once under a new trial ID, and both attempts are kept.
- **Graph activation audit.** A B run is scored as graph only if one of these holds:
  - the target rule reached the model (custom message, blocked-call reason, or tool-result reconciliation) **before** the first successful change to a target-relevant path, through `edit`, `write` or `bash`;
  - no target-relevant path changed at all (vacuous).

  Runs where the target rule arrived after the change, never arrived, or could not be located are reported separately and excluded from the primary B rate. An intention-to-treat B rate that includes them is reported as a secondary measure.

  Target-relevant paths per task:

  | Task | Target-relevant path |
  |---|---|
  | T1, T5 | the routes file |
  | T2, T6 | the domain file |
  | T3, T7 | any allowed path |

## Primary metric and threshold

All rates are pooled over both weak models and all six tasks.

- `rate_A` = accepted A runs / valid A runs.
- `rate_B` = accepted B runs / B runs scored as graph.
- `rate_ref` = accepted reference runs / valid reference runs.
- **D** = `rate_B − rate_A`.
- **Gap closed** G = `(rate_B − rate_A) / (rate_ref − rate_A)`. G is undefined when `rate_ref − rate_A < 0.05`.

| Directional verdict | Rule |
|---|---|
| **BENEFIT** | D ≥ +0.15 **and** false-green rate B ≤ false-green rate A + 0.05 |
| **REGRESSION** | D ≤ −0.15 **or** false-green rate B ≥ false-green rate A + 0.15 |
| **NO OBSERVED BENEFIT** | otherwise |
| **INCOMPLETE** | after exclusions, more than one model × task cell has fewer than 3 valid replicates in a condition, or a weak model cannot be run |
| **INVALID** | harness premises fail (base mismatch, evaluator MANIFEST mismatch, condition leakage) |

**Descriptive measures (not decision rules):**

- D per model and per task;
- gap closed;
- a two-sided Fisher exact p-value for pooled A vs B;
- false greens, tokens, cost, wall time, injected guidance tokens, real tool executions, blocked edits and activation status.

D008 overall stays **INCOMPLETE** whatever this verdict is: T4-COORD is not run, and the evaluator is an AI principal rather than a human or separately credentialed authority.

## Unscored pilots (disclosed and excluded from scoring)

Difficulty pilots ran before this preregistration, all on the weak baseline. Each row below is one pilot run, giving its evaluator outcome:

| Model | T1 | T2 | T3 | T5 | T6 | T7 |
|---|---|---|---|---|---|---|
| haiku-4-5 | — | — | — | REJECT (oracle fail) | ACCEPT | REJECT |
| kimi-for-coding | ACCEPT | ACCEPT | ACCEPT | REJECT | ACCEPT | ACCEPT |

The weak baseline fails some pilots but not all, which meets the calibration target, so the task set was not changed.

Two unscored graph smoke runs (`g01` haiku × T2 and `g02` kimi × T6) checked the activation audit. Both were TARGET_BEFORE_RELEVANT_EDIT and both were accepted.

Earlier unscored items, also excluded from scoring:

- a live Pi activation probe of the fix (disposable PLT-78 fixture copy);
- four blind code-review rounds of PR #5.

## Known limitations declared up front

1. **The evaluator is an AI principal** under the owner's delegation. Its sessions use the same machine's Pi login. D008-LOCAL-004 can therefore reach at most "independent AI evaluator", not "independently authenticated human authority".
2. **No OS sandbox.** Coder and evaluator tool events are audited for any access outside the run's own workspace: the evaluator directory, the pi-atdd repository, other trials and prior evidence. In graph runs, reads of the extension snapshot's canonical convention files are reported but allowed, because reading those files is part of the intervention.
3. **Kimi looks strong in the pilots.** Its cells may sit near the ceiling, which limits how much lift can be measured for it.
4. **Concerns about the fix.** Graph-injected text includes absolute paths into the snapshot. The extension also re-delivers a rule after the tool runs when its proof changes, which costs tokens. Both are reported.
