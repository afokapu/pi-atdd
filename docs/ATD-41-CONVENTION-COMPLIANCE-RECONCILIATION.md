# ATD-41 — convention applicability, remediation and verification ledger

**Delivery:** [ATD-41](https://linear.app/af8/issue/ATD-41) [draft PR #44](https://github.com/afokapu/pi-atdd/pull/44), `feature/atd-41-structural-activation` → `integration/atd-39-ooc-activation`. Original behavioral authority [ATD-22](https://linear.app/af8/issue/ATD-22), reasoning [ATD-25](https://linear.app/af8/issue/ATD-25), telemetry [ATD-30](https://linear.app/af8/issue/ATD-30), integration authority [ATD-39](https://linear.app/af8/issue/ATD-39).

**Corpus pins (not edited):** bundled Bun 356 source rules (upstream `5945d97e18310e7c862c08e73985400935d21346`), Flow 2 (`2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a`), package-local pi-atdd 18. Source-locked total **376 canonical rule IDs**. The sidecar is a separate population: 359 source entries, 390 variants, 2,579 natural-language examples. Its natural-language probes are **not** implementation-compliance witnesses.

## Repeatable source-level reconciliation

`tools/atd-41-rule-ledger.mjs` reads **each** of the 376 real rule files, validates IDs and source counts, emits SHA-256 and a distinct applicability decision/reason per rule, and fails if any rule lacks a scope decision. It does not treat a missing selector match as a waiver. The 58 formerly unclassified source IDs have explicit decisions anchored in their source rule Given/exception and the changed Node/Pi artifacts. The 293 rules outside the declared work areas are separately labeled as not triggered, **not passed**. One external Flow/Desk coordination gate stays open; the report never self-certifies.

Reproduce after repository checkout:

```sh
node tools/atd-41-rule-ledger.mjs --output=/tmp/atd-41-canonical-rule-scope.jsonl
node --experimental-strip-types tools/sidecar-activation-matrix.ts --output=/tmp/atd-41-sidecar-matrix.jsonl
```

`tools/atd-41-quality-audit.mjs` verifies it is using the pinned upstream Bun metric implementation before computing original comment ratio, maintainability, function length, nesting and cyclomatic values on the **changed source set** (including newly added named helpers and class methods), plus TypeScript AST checks for console calls, test self-skips and `process.env` mutations. It fails to produce a verdict if a named function disappears from the checked source. This narrow diagnostic does **not** replace an ATDD-Bun full-repository profile run, native detector suite, or an independent review. It is intentionally not a runtime compliance or merge-authority gate.

```sh
# Run only after checking out pinned upstream ATDD-Bun into .cache-sources/atdd-bun
node tools/atd-41-quality-audit.mjs --enforce
```

## Implemented remedies and original convention connections

| Canonical norm or issue | Corrective behavior | Scoped proof / remaining gap |
|---|---|---|
| `coder.complexity.cyclomatic`, `coder.complexity.length`, `coder.complexity.nesting` | Separated import AST scanning, shell heredoc parsing, evidence trust, typed rule construction, sanitized telemetry records, bounded log reading and proof-to-ID mapping | Pinned original numeric algorithms are executed on named affected functions; any new numeric finding is emitted with rule, file and function. Unnamed callbacks and unrelated inherited files are not certified |
| `coder.quality.comments`, `coder.quality.mi` | Documented actual safety/compatibility invariants; no filler comments or threshold weakening | Pinned original numeric algorithm against changed source modules; comment meaning still requires review |
| `coder.logging.console` | Sidecar CLI uses explicit stdout output; changed TS source is AST-scanned for direct console calls | Scope-specific diagnostic, not whole-repository logging policy |
| `tester.test.isolation-no-live-state`, `tester.test.no-self-skip` | Pi and telemetry tests use isolated `tmpdir()` stores; no test mutates `process.env` to redirect telemetry. Explicit configuration is passed only to the test sandbox | AST scan of the six relevant test sources and actual Node test execution; dynamic filesystem accesses outside known temporary paths remain a reviewer concern |
| `shared.tracker.issue-mandatory`, `coder.tracker.issue-in-branch-and-pr` | Existing ATD-41 issue, branch and PR body linked; original ATD-22 remains In Progress | Tracker CI job; its workflow is still configured nonblocking and cannot certify all other conventions |
| `shared.convention.propose` and source integrity | No edits to Bun/Flow/packaged canonical convention YAML, relationships, selectors, admitted OoC registries or T9 authority | Source-locked catalog CI and PR diff; new audit machinery is outside the authoritative catalog |
| `coder.architecture.hierarchy-import` | Observer recognizes relative `domain` → `integration` imports and static re-exports, including root-level domain; dynamic/aliased/unparsed source remains UNKNOWN | `tests/operational-observers.test.ts`, `tests/operational-activation.test.ts`, `tests/pi-activation.test.ts`; this is partial observer coverage, not a full dependency-graph validator |
| `reviewer.reconciliation.behavioral` | No substitute “all compliant” from a passing unit suite or task-text activation | **OPEN**: independent assembled-behavior review after coordinator's deterministic intake is fixed |
| `coach.workflow.lifecycle` / ATD-39 | Same worker branch and draft integration PR; no main merge or unreviewed authority | **OPEN**: authenticated Flow seat and coordinator intake are not established by GitHub checks |

The scoped rule decisions distinguish an inapplicable *Bun application* rule from a stack-neutral construction obligation. In particular, `tester.test.imports-bun-test` cannot require a Node/Pi package to replace its declared `node:test` harness, and Bun's tracking-plan TelemetryPort constraints are not automatically the same contract as Pi's private local activation JSONL. Applicability is evaluated by authored predicates, not assumed from the mere presence of a name in the catalog.

## Original specification acceptance — independent gate

- **ATD-22 / OBS-001 — PARTIAL:** proven pre-edit `write`, `edit` and static quoted shell source proposals, but opaque/dynamic writes are observable only after tool execution; aliases and semantic resolution remain limited.
- **ATD-22 / OBS-002 — PARTIAL:** all 2,579 `fires`/`doesNotFire` sidecar examples were enumerated/probed as text, **all 2,579 unqualified** for source/phase/finding semantics. Six structural fixtures do not substitute for full acceptance.
- **ATD-22 / OBS-003 — PASS within scope:** no phase inferred from chat or Pi-origin task; trusted revision-bound assertions are tested, but live provider binding is outside this worker.
- **ATD-22 / OBS-004 — PARTIAL:** revision-bound synthetic findings, multiple support, reviewer ingestion and retraction have executable tests. A real validator adapter and authorized REFACTOR consumer path are still absent.

## Verification boundary

A green `npm run check`, real Pi RPC smoke, source SHA-256 parity, zero **scoped** findings and explicit rule scoping are necessary supporting evidence. They do **not** independently verify implementation compliance with all contextually relevant rules, prove agent effectiveness, admit an OoC, grant a T9 realization authority or meet ATD-39's owner/reviewer gate.

**Do not report a compliant / approved / merge-ready implementation from this ledger alone.** Preserve exact tested commit and Actions URL in [draft PR #44](https://github.com/afokapu/pi-atdd/pull/44) and [ATD-41](https://linear.app/af8/issue/ATD-41). A checker failure or unresolved original acceptance remains a blocker, not an automatic waiver.
