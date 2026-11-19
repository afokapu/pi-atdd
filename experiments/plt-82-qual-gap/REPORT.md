# PLT-82 — Qualitative gap check on a hard task (LOY-002 pay with loyalty points)

**Scope of this result.** It is a **lower bound**, **qualitative**, with **n = 1 per cell**. Conventions come from the catalog only: none were written for this task. One blind judge (`openai-codex/gpt-6.1-sol`) scored everything. Differences of 1 rubric point are within what a single run and a single judge can resolve.

## Design as run

| Model | No conventions | With conventions (graph) |
| -- | -- | -- |
| Haiku 5.5 `pi-claude-cli/claude-haiku-5-5` | haiku-baseline | haiku-graph |
| Luna `openai-codex/gpt-5.6-luna` | luna-baseline | luna-graph |
| **Terra** `openai-codex/gpt-5.6-terra` (substitute for Kimi, owner decision) | terra-baseline | terra-graph |
| Opus 5.5 `pi-claude-cli/claude-opus-5-5` (reference) | opus-baseline | — |

**Shared setup for every run**
- Base `4b404362` is a standalone clone of `fixture/`, repo commit `e3b54cdc`.
- The prompt `prompts/coder-prompt.txt` (sha256 `7aa2e96f…`) is the LOY-002 Task block verbatim inside a short wrapper.
- Thinking `medium`, 30 min cap, default tools.
- Pi isolation flags: `--no-session --no-mcp --no-context-files --no-skills --no-prompt-templates --no-extensions --no-themes`.
- Claude models use `--provider pi-claude-cli`, loaded with an explicit `-e`. That extension only registers the provider; Pi still owns the prompt and tools.
- Graph runs add `--append-system-prompt conventions/conventions.md` (sha256 `da51d395…`, about 9k tokens). This is the only difference between conditions.
- I checked from first-turn prompt sizes that each graph run actually received the conventions.

**Conventions.** 21 of the 70 PASS `coder.*` catalog conventions are selected; `conventions/selection.json` holds the rule, the ids and the excluded ids. Only coder-facing fields are included.

### Deviations and incidents (stated plainly)

1. **"Traps targeted" line withheld from coders.** That line in the Task section is evaluator meta, so coders did not see it. Everything else in the section is verbatim.
2. **Kimi try 1 is VOID.** Both Kimi cells hit a provider `429 exceeded_current_quota_error` (5-hour quota) partway through, at around 3 minutes. They are not scored. Evidence is in `results/void/` and `results/VOID.txt`.
3. **Kimi was replaced by Terra.** The owner decided to replace Kimi rather than wait. The coordinator qualified `gpt-5.6-terra` and launched both Terra cells at 06:37Z with this harness (same base, prompt and conventions file; hashes verified).
4. **Kimi try 2 is supplementary and out of design.** The Kimi quota reset at 06:28Z, and both Kimi cells were re-run fresh and finished validly at 06:33Z, before the owner decision reached the operator. Per that decision they are **not part of the 7-run design or the final ranking**. They are reported below as supplementary data, not as VOID, because the runs were complete and valid.
5. **Grading happened in two blind batches.**
   - Batch 1: 7 anonymised results (the 5 design runs plus the 2 Kimi try-2 runs).
   - Batch 2: the 2 Terra results, followed by one combined ranking of the 7 design ids. The judge re-checked the batch-1 trees and verdicts and ran the same supplementary probes across all 7.
   - The final ranking is `verdicts/ranking-final.json`. The batch-1 ranking, which includes Kimi, is `verdicts/ranking-batch-1.json`.

## Evaluator

- A fresh sol session (thinking high) wrote the hidden tests, the store-call counter, `run-hidden.mjs` and `rubric.md` before any coder run, from TASK.md and base only.
- Its `MANIFEST.json` has sha256 `314dcf8e…`. It was posted on PLT-82 before the runs, and the evaluator files were frozen read-only.
- There are 16 counted hidden tests plus 1 informational efficiency test. On the base: 0 of 16 pass.
- The rubric has 10 criteria, each scored 0–3, for a total out of 30. Ranking is lexicographic: counted passes, then the functional subtotal (criteria 1–7), then the total, then efficiency, then layering.
- Results were anonymised to opaque ids. No redaction was needed: no model or condition strings appeared in the trees, diffs or reports.
- The operator did not read the evaluator materials until all verdicts existed.

## Results — the 7 design runs (final combined ranking)

Trap columns: ORD order/rounding · LOT lots · IDM idempotency · RACE concurrency · REV reversal+expiry · AUTH auth/ownership · PEND pending-only · CLK clock. Y = handled, P = partial.

| Run | Hidden (counted) | ORD | LOT | IDM | RACE | REV | AUTH | PEND | CLK | Eff. | Layer | Rubric /30 | Rank | Tokens total (output) | Turns |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| haiku-graph | 16/16 | Y | Y | P | Y | Y | Y | Y | Y | 1 | 3 | **27** | **1** | 1,275,531 (48,158) | 20 |
| opus-baseline (ref) | 16/16 | Y | Y | Y | Y | Y | P | Y | Y | 1 | 2 | **26** | **2=** | 264,300 (17,392) | 12 |
| terra-graph | 16/16 | Y | Y | Y | P | Y | Y | Y | Y | 1 | 2 | **26** | **2=** | 564,288 (12,545) | 24 |
| terra-baseline | 16/16 | Y | Y | Y | P | Y | Y | Y | Y | 1 | 1 | 25 | 4 | 160,006 (6,777) | 16 |
| haiku-baseline | 16/16 | Y | Y | Y | P | Y | P | Y | Y | 1 | 2 | 25 | 5 | 612,147 (33,381) | 16 |
| luna-graph | 16/16 | Y | Y | P | P | P | Y | P | Y | 1 | 1 | 22 | 6 | 280,405 (6,484) | 15 |
| luna-baseline | 14/16 | P | Y | Y | P | P | Y | P | Y | 1 | 1 | 21 | 7 | 148,085 (6,528) | 15 |

Notes on the table:
- **Tokens** are input + output + cache read + cache write, as reported by Pi.
- **Report honesty** scored 3/3 for every design run.
- **Rank 2** is a true tie under the frozen rubric: counted passes, functional subtotal, total, efficiency and layering are all equal. The specific defects differ.
- **Hidden tests barely separate the runs:** 6 of 7 pass all 16. The differences come from the code review and the evaluator's supplementary probes:
  - idempotent replay that bypasses ownership or recomputes tax;
  - a tax-configuration failure after the debit that leaves points spent with no receipt;
  - pending validation outside the ledger critical section.

### Supplementary (out of design): Kimi try 2, graded in batch 1 only

| Run | Hidden | ORD | LOT | IDM | RACE | REV | AUTH | PEND | CLK | Eff. | Layer | Rubric /30 | Batch-1 rank (of 7) | Tokens total (output) | Turns |
| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| kimi-baseline | 14/16 | P | Y | Y | P | P | Y | P | Y | 1 | 2 | 22 | 6 | 447,429 (18,202) | 23 |
| kimi-graph | 16/16 | Y | Y | Y | P | P | Y | P | Y | **0** | 2 | 21 | 5 | 476,353 (19,625) | 19 |

## Per weak model: with vs without conventions, and distance to Opus (26)

- **Haiku 5.5:** 25 → **27**, one point **above** Opus.
  - RACE went from partial to yes, and AUTH from partial to yes (replay now re-checks ownership).
  - Layering went from 2 to 3.
  - **Regression:** idempotency 3 → 2, because the replay recomputes tax instead of returning the stored result.
  - Cost: total tokens 2.1× and output 1.4×.
- **Terra:** 25 → **26**, equal to Opus.
  - The only rubric change is layering, 1 → 2.
  - Cost: total tokens 3.5×, output 1.9×, turns 16 → 24.
- **Luna:** 21 → 22, still **4 below** Opus.
  - Counted tests rose from 14 to 16 because the calculation-order trap was fixed. **No convention covers that trap**, so I read this as run-to-run variance, not convention effect.
  - **Regression:** idempotency 3 → 2.
  - Layering stayed at 1.
  - Cost: total tokens 1.9×.
- **Kimi (supplementary):** 22 → 21, an overall **regression** despite 14 → 16 counted tests.
  - Concurrency fell 2 → 1, and efficiency 1 → 0.
  - This is consistent with PLT-79's observation that the graph can distract Kimi.

Where the signals plausibly come from conventions (n = 1, so hedged):
- **Auth/ownership:** this is the one trap a selected convention covers (`security-missing-auth`). Every graph run handled it fully. The two runs graded partial were haiku-baseline and the Opus reference.
- **Layering:** scores improved for Haiku and Terra, which fits the catalog's layering and dependency-direction conventions. Luna's layering did not change.

## Traps no convention covered (candidates for the next conventions)

- **Money order and rounding:** apply points after the discount and before tax; compute tax on the reduced amount; never go below zero; consume no excess points.
- **Idempotency:** store and replay the original result, without recomputing it from current configuration. Re-authorise the caller on replay. Reject the same key sent with a different body.
- **Atomic check-and-debit on an async store:** this includes commit consistency. Do every fallible step (pricing, validation) **before** the debit, or compensate, so a failure never leaves points debited without a receipt. Re-check the pending state inside the critical section.
- **Ledger reversal:** return points to the original lots with their original expiry, and forfeit points whose lot has expired by cancel time.
- **Time as a parameter:** every run handled it here, so there is no evidence of a gap.
- **Efficiency:** look up usable lots through an index or query, with no full-history scan. **No run scored above 1/3**, Opus included. This is the clearest gap that conventions could close for every model.

## Verdict, in the issue's terms

On this hard, multi-constraint task, the **catalog-only** conventions (a lower bound) moved two cheap models to Opus's rubric level: Haiku 5.5 to 27 and Terra to 26, against Opus at 26. Luna moved +1 but stayed well below. The supplementary Kimi run regressed by 1.

The gains are concentrated where the catalog has conventions: auth/ownership and layering. The traps the catalog does not cover (idempotent replay, commit-consistent debit, efficiency) stayed partial or regressed in some graph runs. **Regressions:** Haiku and Luna both lost a point on idempotency with conventions, and Kimi lost a point overall.

The price is 1.9–3.5× total tokens for the graph runs. Every cheap run still cost far less than Opus in Pi's nominal pricing: about $0.01–0.34 against $0.65, though both Claude runs are on the subscription.

All of this is qualitative, n = 1 per cell, from a single judge. It is not a statistical claim.

## Layout

- `fixture/` — the base.
- `conventions/` — `conventions.md` and `selection.json`.
- `prompts/` — the task, coder prompt, evaluator prompts and rendered prompts.
- `harness/` — the run scripts, reusing the PLT-79 `pi-run.mjs`.
- `evaluator/` — frozen evaluator materials, published after the verdicts.
- `results/<run>/` — `run.json` (tokens, turns, wall time, tool events), `result.diff`, `report.md`, the mechanical `hidden/` run, and `evaluator/verdict.json` with probes.
- `results/void/` — the VOID Kimi try 1.
- `verdicts/` — the final and batch-1 rankings and the judge's summaries.
- `qualify/` — the one-prompt qualification outputs.
