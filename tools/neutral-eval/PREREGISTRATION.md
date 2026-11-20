# PLT-84 evaluation: Bun regression and second-stack arms (preregistration)

Written and pushed **before any scored run**. Evaluator files: `EVALUATOR_MANIFEST.sha256` (SHA-256 of that manifest: `e4d6266267c9624a70fb572ea8190ed0a1137a975f994261b8a1160296f95db3`).

## Questions
1. **SN-001 Bun regression.** On fresh tasks, is the new pi-atdd (commit `c5b077f7f907`) worse than 0.2.0 (`v0.2.0-bun-baseline`) for Bun-layout work?
2. **Second stack (ts-hexagon).** Does core + profile + Bun reference example (arm C) beat core + profile alone (arm B)? Do B and C beat no conventions (A)?

## Design
| Item | Value |
|---|---|
| Fixture | The PLT-79 orders-service, plus an additive overlay (`delta/`) that the evaluator authored for 4 fresh tasks: F1-AUTH, F2-AUTH (rule: authorisation in mutating handlers), F3-ARCH, F4-ARCH (rule: dependency direction). |
| Hexagon fixture | The same service, mechanically ported by renaming path segments (domain→core, application→usecases, integration→adapters, routes→http, old http→server). Tasks, oracles and references are ported the same way. |
| Bun arms | `v020`: `-e <0.2.0 snapshot>/extensions/atdd.ts`. `new`: `-e <c5b077f7f907 snapshot>/extensions/atdd.ts`. Nothing else differs. |
| Hexagon arms | A: task prompt only. B: prompt + the conventions the real role activation selects under the ts-hexagon profile, rendered as core + profile values, no Bun material. C: as B plus the Bun realization labelled as a reference example. No extension in any hexagon arm. |
| Coders | `zai/glm-5.3` and `kimi-coding/kimi-for-coding`, thinking low, default tools. Claude is not used (quota). |
| Replicates | 3 per model × task × arm. Bun: 4 tasks × 2 models × 2 arms × 3 = 48 runs. Hexagon: 4 × 2 × 3 arms × 3 = 72 runs. Order is a seeded shuffle. |
| Workspace | A fresh copy of the base with a git base commit per run, no remote. 20 minute limit per run. |
| Evaluator | `openai-codex/gpt-6.1-sol` authored the tasks, held-out oracle tests, correct and naive references and validation. The operator re-ran validation mechanically (`validation-mine.json`): base fails the visible test, the correct reference passes visible and oracle, every naive reference passes visible and fails the oracle, in both layouts (8/8 valid). The operator did not read the oracle files before the runs. |

## Outcome
* **Accepted** = only allowed paths changed, the visible test passes, and the whole held-out oracle passes.
* **Deviation from PLT-79:** there is no blind evaluator verdict session per run; "accepted" is mechanical. This removes the evaluator's judgement of the report and of rubric items, and is cheaper. Per-trap oracle results are reported.
* **Valid run:** at least one real tool execution. A timeout is valid and not accepted. A provider failure with zero tool executions is INVALID; it is retried once as a new attempt (both kept), and a second failure stops the evaluation.
* **Bun activation audit:** for `v020` and `new`, the run records whether the target rule reached the model before the first successful edit. Runs where it did not are reported, and the primary rate includes all valid runs (intention to treat).

## Decision rules (fixed before outcomes)
* **Bun regression:** D = accepted rate(new) − accepted rate(v020), pooled over 24 runs per arm. **REGRESSION** if D ≤ −0.15, else **NO REGRESSION** (a smaller drop or any rise). Per-model and per-task rates are descriptive. n is small; two-sided Fisher p is reported, not used to decide.
* **Hexagon:** rates per arm over 24 runs. **C beats B** if rate(C) − rate(B) ≥ +0.15, **B beats C** if ≤ −0.15, otherwise **NO DIFFERENCE**. The same ±0.15 rule is applied to B vs A and C vs A.
* **Cost:** per-run cost is Pi's `usage.cost` from each session log (nominal; all providers are subscriptions).
* **Stops:** a quota-exhaustion error stops the run and is reported; a 429 that Pi retries successfully is not a stop (deriver concurrency per provider steps down at a 429). No provider is substituted.

## Limits stated in advance
Four tasks, two weak models, three replicates: the power to see ±0.15 is low. Two of the four hexagon tasks test a rule (authorisation) whose canonical wording does not cover the ownership trap, so a null result for B/C on those is expected. The hexagon fixture is a rename of the Bun-layout service, so it tests layout independence, not language independence. The agent-derived realization is unverified by construction.
