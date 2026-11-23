# PLT-132 — source-qualified convention graph reconciliation

**Status:** draft repair, independently review before merge. Companion research: [PLT-107](https://linear.app/forge100/issue/PLT-107) and T9 [draft PR #34](https://github.com/forgeonehundred/t9-compiler/pull/34). The generalized T9 [Change Realization Contract (PLT-110)](https://linear.app/forge100/issue/PLT-110) remains *research only*.

## Frozen source authority

- Pi source revision: [`3007c13958def5879106c4612f10bef8d524e9db`](https://github.com/afokapu/pi-atdd/tree/3007c13958def5879106c4612f10bef8d524e9db).
- Bun catalog lock: `5945d97e18310e7c862c08e73985400935d21346`, SHA-256 `fb6173026d0a5caef9de4ad7daa6433cfe36e6aca5bccdc826b1e5a92903a28a`. Bundled Bun normalized graph Git blob `adc022833803a5907b0c0d1d65358f4ba14cf8fc`.
- Original imported-core relation provenance: [ATDD `36ce055ae5056d7a0f7d012c1e4aaa5df628ce51`](https://github.com/afokapu/atdd/tree/36ce055ae5056d7a0f7d012c1e4aaa5df628ce51).
- Original core/Vite realization source: [ATDD Extensions `3aa141ecca1bf96d38964c1b8d4cf2e62b8efdfe`](https://github.com/afokapu/atdd-extensions/tree/3aa141ecca1bf96d38964c1b8d4cf2e62b8efdfe).
- **Do not** use lexical lookalikes or inference to change a `requires` edge's target. Every external source reference is pinned to a source `*.convention.yaml` blob in [the checked-in disposition ledger](../conventions/relationship-reconciliation.json).

## Baseline inventory and dispositions

| Category | Baseline edges | Post-reconciliation treatment |
|---|---:|---|
| Explicitly authored legacy alias: `planner.acceptance.complete` | 10 | Resolve to the actual loaded `planner.acceptance.well-formed` rule. Its `metadata.aliases` and `source.legacy_rule_id` document the equivalence and the narrower **local shape** guarantee; it is **not** a promise that an entire desired outcome's acceptance set is complete. |
| Term-qualified references | 2 | Project to the containing loaded convention with `originalTarget` and `targetTerm` retained. The `#harness_code` term is exact. The upstream `#harness_type` reference is not a declared term of `planner.acceptance.harness`; the authored term `harness` is the source-grounded adapter correction, separately visible for review. |
| External ATDD core references | 14 | Preserve the original relation and source; classify **external-normative-source**. Do not fabricate a locally loaded source/target convention. |
| External Bun-to-core/Vite realization references | 18 | Preserve the original relation and exact external source; classify **external-realization**. The authored type remains `requires` until source owners ratify a separate realization-vs-prerequisite relation profile. Do not misinterpret the explanation as a license to waive mandatory `requires`. |
| **Total** | **44** | **Zero *unclassified* dangling references** for this pinned bundle, while **32 qualified external references remain nonlocal/unfulfilled**. |

The authored relation graph still contains **522** edges (508 Bun and 14 local), including **299** mandatory `requires`. After these explicitly qualified projections, **269 mandatory `requires` edges have two loaded local endpoints**; **30** point to a separately pinned external endpoint and are **not locally satisfied**. The original 44 represent *reference resolution classes*, not 44 omitted new conventions.

### Negative controls

1. A `coder.design.token-color` source target is a different external author-owned identity than the Bun `coder.ui.token-color` realization. Redirecting the edge to itself would create a false self-`requires`; it is explicitly forbidden.
2. A missing external mandatory target does not become a compliant rule merely because a source path or external registry was located. Existing Pi `requires_missing` facts still yield `incomplete`.
3. `runs_alongside`, `follows` and `enables` never become a mandatory `requires` proof.
4. A term-qualified endpoint is checked against the actual target rule's `terms[].term_id`; absence causes an explicit error.
5. A changed Bun source lock does *not* inherit these qualified projections; it requires a new source audit. A truly novel unmatched reference in the pinned graph also fails fast instead of being silently classified as an external rule.
6. The consumer-independent `sourceRef`, `targetRef`, `origin`, `control`, qualifiers, source blob, and any migrated alias remain inspectable in the ledger.

## Tests and compatibility

Run `npm run check` (TypeScript and full Node suite), `npm run smoke:catalog`, `npm run smoke:pi` and `npm run smoke:install` on the PR head with its pinned package dependencies. The [dedicated full-graph test](../tests/relationship-reconciliation.test.ts) verifies the 44-way classification, aliases/term projection, 32 external source pins, 269 internal mandatory links, cross-profile requires, nonrequires exclusions, no self-dependency, acyclicity, missing-target refusal, and **Pi Datalog proof propagation**.

This does **not** constitute runtime parity with a future T9 generic resolver: [PLT-107 acceptance 13](https://linear.app/forge100/issue/PLT-107) remains open until that actual resolver consumes identical provider-authored applicability and source-locked relation facts and matches independently reviewed Pi outputs. Likewise, the rule matching described by [PLT-110](https://linear.app/forge100/issue/PLT-110) is a proposed `Change Realization Contract` family (typed `form/template` or `convention`); the graph repair implements **neither** the T9 contract selector nor Change Path preflight.

No active `*.convention.yaml`, source lock, Decision OS registry, T9 schema, observed state, causal Driver, or permission grant was changed. No merge is requested by this research/repair.
