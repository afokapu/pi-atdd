# Migration ledger — pi-atdd

Status: initial adversarial source-level inventory, NOT full semantic parity. **Active V1 source conventions are ATDD-Bun and ATDD Flow; TypeScript owns the extension, resolver, CLI, and tests.** Existing consumers must retain the old toolkits until parity tests and a reviewed cutover pass.

## Immutable source anchors (2026-11-18 UTC)

| Repository | Commit |
|---|---|
| [atdd](https://github.com/afokapu/atdd) | 28a9fd1813b0cce660add5535f2f73f416168e6c |
| [atdd-bun](https://github.com/afokapu/atdd-bun) | 5945d97e18310e7c862c08e73985400935d21346 |
| [atdd-flow](https://github.com/afokapu/atdd-flow) | 2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a |
| [atdd-linear](https://github.com/afokapu/atdd-linear) | fab20ad2fff7f403006f45a18b3ed4e74680ae90 |
| [atdd-extensions](https://github.com/afokapu/atdd-extensions) | 3aa141ecca1bf96d38964c1b8d4cf2e62b8efdfe |

## Classification vocabulary

- P = convention/policy: WHAT and WHY, without executable mechanism.
- G = graph/schema/plan: canonical IDs, relationships, closure and acceptance meanings.
- V = detector/proof: executable checks, findings, test evidence and diagnostics.
- R = runtime: exact JJ ancestry, process fencing, durable delivery, concurrency, idempotency.
- I = integration: replaceable Linear/GitHub/CI provider and foreign identities.
- X = candidate to retire ONLY after demonstrated replacement.

The classification is about *responsibilities*, not whole files. A module may contain all three of policy, validation, and runtime state.

## ATDD-Bun inventory

| Files | Classification | Migration treatment |
|---|---|---|
| relationships.yaml, conventions/**, planner-nodes/**, planner-schemas/** | G/P | Read canonical YAML unchanged through locked local sources; preserve semantics of each relationship verb |
| src/profile-registry.ts, src/enforce.ts | G/V | Reuse rule/detector mapping; do not assume all findings should fail; preserve source dispositions |
| src/planner-kernel.ts, src/planner-schema-validator.ts, src/planner-validators.ts, src/topology.ts | G/V | Extract plan parser and closure with fixture equivalence tests |
| src/hooks.ts | P/R/X | Lift micro-PR and blast-radius *intent* into policy. Replace Git hook delivery; keep JJ-safe revision checks |
| src/ratchet.ts | V/R | Exact-base fingerprint ratchet; NOT equivalent to Python ratchet count baselines |
| src/integrity.ts, src/ci.ts, src/register.ts | V/R | Independent verification must still operate without Pi; replace generated controls before uninstall |
| src/agent.ts, src/setup.ts | I/X | Replace managed blocks with tiny pointers; only remove generated content marked as owned |
| src/journey-docs.ts, src/docs-capability.ts | G/I | Optional views, not a new task authority |
| src/telemetry-plan.ts | G/V | Preserve identity/cardinality/acceptance obligations if a consumer uses them |
| src/owner-inspection-evidence.ts, src/release.ts | P/V | Separate review/release authorization from report generation |
| detectors/**, lib/imports.mjs, lib/interlocking.mjs, lib/journey-chain.mjs | V | Preserve rule-to-detector evidence selectively; TS import analysis is not Python import analysis |
| .githooks/**, atdd-bun.integrity.test.ts and generated workflow in consumers | X/R | Clean with owner-aware migration script; required CI status checks need replacement |

## ATDD Flow inventory

| Files | Classification | Migration treatment |
|---|---|---|
| conventions/atdd-flow.collaboration/**, conventions/atdd-workflow.workflow/** | P | Existing policy; separate transferable rules from Desk-specific implementation text |
| src/core.ts, src/seats.ts, src/tasks.ts | P/R/X | Extract authority/ancestry requirements; let Linear own human work state; retain exact transitions as code |
| src/vcs.ts, src/vcs-migration.ts, src/retire-merge-proof.ts | P/R | Keep JJ workspace creation, clean/stale head detection, safe retirement and merge proof |
| src/reviews.ts, src/judgment.ts | P/V/R | Independent reviewer verdict is tied to exact clean revision. Model routing is heuristic, not an approval |
| src/threads.ts, extensions/pi/index.ts, src/runtime-state.ts, src/pi-wake*.ts | R | Keep durable inbox, role/run address, owned delivery, acknowledgment and idempotency; retire separate task/thread DB |
| src/reconcile.ts, src/mail-activation-notice.ts, src/next-action-notices.ts | P/R | Preserve bounded retry and missed notification recovery, not prompt storms |
| src/handover.ts, src/recovery-bundle.ts, src/same-pane-new.ts, src/exact-adoption-recovery.ts, src/adoption-authorizations.ts | P/R | Preserve recovery evidence and session fencing; reconcile the runtime prompt with target compaction policy first |
| src/pi-runtime-launch.ts, src/operator-launch.ts, src/context-monitor.ts, src/ephemeral-resources.ts | R | Reuse only required supervisor mechanisms, not the full Desk |
| src/linear-mirror.ts, src/linear-graphql.ts, src/linear-cli.ts | I/P | Outbound Flow-authoritative mirror is NOT a Linear-authoritative work adapter |
| src/owner-inspection*.ts, src/owner-escalations.ts, src/address-book.ts | P/V/I | Authority and exact evidence remain; do not rebuild operator-seat bureaucracy |
| src/multiplexer.ts, multiplexer/**, src/overview.ts, src/adapters.ts | R/X | Display and process placement are optional projections, never a second project manager |
| src/collaboration-policy.ts | P/I | Runtime prompt assembled from canonical convention; compare injected text with policy before migration |

## Legacy ATDD core and Extensions — historical comparison only

| Files | Classification | Migration treatment |
|---|---|---|
| src/atdd/enforce/dispositions.py | P/V | Reuse strict, advisory, suppress-and-clean and documentation-only treatments. BOUND is a different binding state |
| src/atdd/enforce/ratchet.py, runner.py, ci_gate.py, gating.py | V/R | Count-based baseline differs from Bun fingerprint ratchet; explicitly choose and test future behavior |
| src/atdd/enforce/registry.py, resolution.py, conventions.py, substrate_guard.py | G/V | Reuse validated resolution/integrity where possible |
| src/atdd/substrate/{admission,coherence,installer,registry,resolver,staleness}.py | G/R | Preserve substrate semantics, not necessarily the provider runtime hierarchy |
| src/atdd/planner/**, src/atdd/journey/** | G/V | Preserve plan schemas, acceptance meaning and journey proof, not only metadata labels |
| src/atdd/train/**, src/atdd/coach/** | P/R/X | Separate lifecycle obligations from the legacy local issue, store and phase state machine |
| atdd-extensions/official/atdd.extension.coder.base/conventions/** | P | Historical lineage only; NOT an active V1 convention source. Bun and Flow are canonical. |
| atdd-extensions/official/atdd.workspace.python-pytest/implementations/** | V/X | Historical reference, not a dependency or runtime to port; V1 executes TypeScript tests. |

## ATDD-Linear

| Files | Classification | Migration treatment |
|---|---|---|
| src/plan.ts | G/I | Imports loadPlan, topologyFor and PlanArtifact from @afokapu/atdd-bun. Must be replaced before uninstall |
| src/linear.ts, src/sync.ts, src/config.ts | I | Preserve pagination/idempotency, replace one-way authority with Linear work ownership by explicit field |
| src/evidence.ts, src/render.ts, src/cycles.ts, src/release.ts | V/I | Reuse acceptance evidence and helpful views without duplicating work state |
| src/docs.ts, src/asciidoc.ts, src/notes.ts, src/agent.ts | I/P | Respect user-authored notes and avoid overwriting human-owned fields |

## Cross-cutting invariants

- No one-agent self-certification of acceptance or a proposed alternate architecture.
- No change to a canonical rule disposition simply to make an existing implementation pass.
- No loss of authorized-main merge boundaries, coordinator integration branch ancestry or exact-head verification.
- No silent drop or requeue of outstanding Flow mail during cutover.
- No duplicate agent wake while previous runtime still owns a seat/run.
- No assumption that Linear comments are a reliable live-process message bus.
- No broad full-suite run on each JJ edit/commit. Mandatory CI remains independent.
- No claim that static acceptance binding proves behavioral correctness.
- No claim that fewer rules selected means no relevant rules exist; selector coverage gaps are explicit.
- No unreviewed removal of generated hooks, status checks, package imports, plan files or managed instruction blocks.

## Decommission gate

Only retire old toolkits when all eight parity areas pass: plan/graph parsing, rule treatment, traceability/behavior, JJ exact ancestry, durable messaging/recovery, Linear idempotency/permissions, independently enforced CI, and owner-aware cleanup/rollback. Every cutover needs a reproducible old-vs-new evidence comparison. This initial migration ledger is intentionally incomplete; source modules have been enumerated and representative logic inspected, but exhaustive per-rule detector parity is a separate PR.

## ATD-41 — Operational observation slice (integration candidate, 2026-11-22)

- **Preserve:** Source-locked Bun/Flow YAML/digests and authored mandatory `requires` closure; existing selector/path matching, Pi edit/write/shell preflight, post-tool repository observation and local sanitized telemetry.
- **New, still advisory:** A syntax-grounded `domain/ → integration/` import-presence and before/after `import_added` fact; bounded `file_kind`; revision-bound `finding` and explicitly trusted `phase` ingestion; in-memory proposal-only ATD-39 observation/proof envelope. Dynamic shell mutations lack before/after preflight proof and are observed after execution when possible. Source tree is not an OoC ledger or T9 realization authority.
- **Unverified scope:** Full 358 convention-sidecar replay, cross-host hook parity, semantic OoC/Change Path binding, independent effectiveness of agent behavior and source-level compliance. The legacy broad domain-edit selector and negated-language false positive remain visible in the labeled replay, not silently waived.
- **Validation:** See [ATD-41 structural activation evidence](./ATD-41-STRUCTURAL-ACTIVATION-EVIDENCE.md), current-head draft PR checks, and ATD-39 integration review; no owner cutover or merge decision is implied.
