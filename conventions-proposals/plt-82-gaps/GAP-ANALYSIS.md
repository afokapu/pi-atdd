# Gap analysis: PLT-82 traps vs pi-atdd v0.2.0 conventions

**Compared against:** tag `v0.2.0-bun-baseline` (commit `a20ccd03`), `conventions-sidecar/`:

- 144 `atdd-bun` conventions
- 197 planner nodes
- 2 `atdd-flow` conventions
- 15 split sources (46 parts)

Together these cover 358 of 358 canonical conventions.

**Method:**

1. Keyword scan of every agent-facing field: title, given, when, then, prefer, avoid, why. Terms searched: money and rounding, idempotency and replay, race, atomic, lock and transaction, reversal, compensation and refund, clock and time, scans and indexes, ownership, side effects.
2. A manual read of every hit.

All hits were incidental:

- planner or workflow rules about plan artifacts, such as atomic commits of plan files;
- `runtime-single-lockfile` (the word "lock");
- telemetry "transaction";
- tester denial tests.

No coder-level convention addresses any trap below.

**PLT-82 evidence** comes from the rubric (0–3) given by the blind evaluator to the 7 design runs. `<3` counts the runs that were not fully correct. Opus is the reference.

| Trap (PLT-82) | v0.2.0 coverage | Nearest existing | PLT-82 evidence (design runs <3) | Proposal |
| -- | -- | -- | -- | -- |
| Money representation and rounding | none | — | 1/7 on order/rounding (luna-baseline 1) | `coder.money.integer-minor-units` |
| Adjustment sequence, floor, excess not consumed | none | — | same criterion as above | `coder.money.adjustment-sequence` |
| Idempotent replay returns the stored outcome | none (`coder.htmx.verb-mutation-signals-progress` is UI progress only) | — | 2/7 (haiku-graph, luna-graph: replay recomputed from current configuration) | `coder.mutation.idempotent-replay` |
| Same key, different request → reject | none | — | tested in hidden tests; all design runs passed | `coder.mutation.idempotency-key-mismatch` |
| Atomic check-and-act on an async store; preconditions re-checked inside | none | — | concurrency 5/7; pending-only 2/7 (luna ×2: pending state checked or written outside the atomic unit) | `coder.concurrency.atomic-check-and-act` |
| Fallible steps before an irreversible effect | none | — | evaluator probes: terra ×2 and haiku-baseline debited before a pricing lookup that can fail, leaving no record | `coder.mutation.fallible-before-irreversible` |
| Reversal to the original sources, rules applied at reversal time | none | — | 2/7 (luna ×2) | `coder.compensation.restore-provenance` |
| Time as an input to domain rules | none (`coder.bun.commons-domain-no-framework-import` forbids runtime imports, but a global clock read is not an import) | domain purity | 0/7: every run passed it in; kept because it is a stated issue trap with no coverage | `coder.domain.time-as-input` |
| Bounded reads, no full-history scans | none | complexity and maintainability rules only | **7/7** scored efficiency 1/3, Opus included | `coder.data.bounded-reads` |
| Resource ownership on every path, including replay | partial: `coder.bun.security-missing-auth` requires an auth guard in the mutating handler; `tester.bun.security-auth` requires denial tests | authentication only | 2/7 (opus, haiku-baseline: replay returned the stored response before the ownership check) | `coder.security.resource-ownership` |

**Already covered in v0.2.0 and seen helping in PLT-82** (n = 1, hedged):

- auth guard in the mutating handler: every graph run handled AUTH fully;
- layering and domain purity: the layering score rose for Haiku and Terra with conventions.

No new convention is proposed for these.

## Suggested graph edges (for `relationships.yaml` / overlay, not applied)

- `coder.security.resource-ownership` **relates to** `coder.bun.security-missing-auth`: authentication vs resource-level authorisation.
- `coder.mutation.idempotent-replay` **requires** `coder.security.resource-ownership`: the replay path must re-authorise.
- `coder.mutation.idempotent-replay` **relates to** `coder.concurrency.atomic-check-and-act`: the key lookup must sit inside the same serialisation as the effect.
- `coder.mutation.idempotent-replay` **relates to** `coder.mutation.fallible-before-irreversible`: the outcome record is written with the effect.
- `coder.compensation.restore-provenance` **relates to** `coder.domain.time-as-input`: validity is evaluated at reversal time.
- `coder.money.adjustment-sequence` **relates to** `coder.money.integer-minor-units`.

## Caveats

- **Circularity.** The proposals were written after seeing LOY-002 failures. A re-run on LOY-002 would overstate their value, so validate on fresh tasks with a fresh evaluator.
- **No independent audit yet.** The operator model wrote them. The lint is mechanical only.
- **Evidence is thin.** It is n = 1 per cell from one judge, and several gaps (mismatch rejection, time as input) did not produce failures in PLT-82. They are proposed because the issue named them and v0.2.0 has no coverage, not because PLT-82 showed harm.
