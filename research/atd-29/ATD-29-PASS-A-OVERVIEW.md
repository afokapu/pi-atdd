# ATD-29 — complete Agent A source review and Pass A handoff (provisional)

**Original authoritative requirement:** [ATD-29](https://linear.app/af8/issue/ATD-29), Acceptance-01..04, within [ATD-26](https://linear.app/af8/issue/ATD-26). [ATD-40](https://linear.app/af8/issue/ATD-40) was the earlier partial delivery, not a substitute specification. **Branch was created from** `integration/atd-39-ooc-activation@567b2e513782b380c18f320d69edf140d61a36d4`, never from main. The legacy merged draft PR #43 inventoried sources but left 362 without semantic assessment; this continuation is **not** another filename-only inventory.

## Exact evidence standing — do not conflate stages

**Agent A work:** source inspection and provisional semantic extraction for the **entire frozen corpus of 376** non-fixture convention files (356 Bun, 2 Flow, 18 local). The source body, terms/values, normative content/exceptions, implementation/validator pointers and typed graph witnesses were read. Original Bun/Flow/local source bytes and all digest locks were unchanged. Per-rule explanations live in the nine source-specific assessment batches, with exact immutable GitHub YAML links and negative/exception controls. All 362 formerly unreviewed rules were addressed in these batches, not merely assigned the string UNRESOLVED.

| Research disposition | Source files | Meaning |
| --- | ---: | --- |
| `CANDIDATE` | **339** | A proposed direction-neutral state-bearing Resource class/aspect and source-backed manifestation/negative lens was recorded. **Not** proof that an actual OoC identity passes O1–O8 |
| `NO_CANDIDATE` | **31** | The source was reviewed and is a procedure, taxonomy, example, authoring prompt or legacy implementation-placement instruction without an independently evidenced state bearer in this extraction. Its convention obligation is **not waived** |
| `UNRESOLVED` | **6** | A concrete competing authored clause/identity contradiction requires independent adjudication. **No remaining default unreviewed files** |
| **Total** | **376** | All filenames/YAML rule IDs, per-source Git blobs and vendor source SHA256s stay exactly pinned |

There are **290 distinct provisional candidate labels**, with **42 labels supported by multiple source files**. These are **not 290 admitted OoCs**. The [source-complete candidate index](./ATD-29-PROVISIONAL-CANDIDATE-INDEX.tsv) enumerates every label with exact supporting rule IDs, source paths, independently described state/measurement witnesses, negative controls and the batch/source evidence report. Some labels represent composite or adjacent state aspects and must be split/merged if independent O1–O8 challenge requires; neither count is an admission verdict.

### Where each source was assessed

| Batch | Original source families | Source files examined | Candidate | Reasoned no candidate | Specific unresolved |
| --- | --- | ---: | ---: | ---: | ---: |
| [Original ATD-40 source examples](../atd-40/ATD-40-PASS-A-EVIDENCE.md) | 13 Bun/local candidates, 1 local negative | 14 | 13 | 1 | 0 |
| [01 — Local + Flow](./ATD-29-SEMANTIC-BATCH-01.md) | 11 local, 2 Flow | 13 | 13 | 0 | 0 |
| [02 — Bun coder](./ATD-29-SEMANTIC-BATCH-02.md) | Architecture, runtime, security, UI, telemetry, traceability | 70 | 70 | 0 | 0 |
| [03 — Acceptance and desired-outcome planning](./ATD-29-SEMANTIC-BATCH-03.md) | 29 planner rules | 29 | 23 | 6 | 0 |
| [04 — Appendix / artifact identity](./ATD-29-SEMANTIC-BATCH-04.md) | 24 planner rules | 24 | 22 | 1 | 1 |
| [05 — Capability / component / coverage](./ATD-29-SEMANTIC-BATCH-05.md) | 42 planner rules | 42 | 35 | 6 | 1 |
| [06 — Decomposition / docs / features](./ATD-29-SEMANTIC-BATCH-06.md) | 36 planner rules | 36 | 33 | 3 | 0 |
| [07 — Reviewer / shared / tester](./ATD-29-SEMANTIC-BATCH-07.md) | 54 Bun rules | 54 | 53 | 0 | 1 |
| [08 — Plan integrity / journey / contracts / telemetry](./ATD-29-SEMANTIC-BATCH-08.md) | 53 planner rules | 53 | 41 | 12 | 0 |
| [09 — User/system flow and router](./ATD-29-SEMANTIC-BATCH-09.md) | 41 planner rules | 41 | 36 | 2 | 3 |
| **Total** | | **376** | **339** | **31** | **6** |

The [frozen-source ledger](../atd-40/ATD-40-PASS-A-LEDGER.tsv) retains all 376 convention identities/paths/blobs, 522 authored Bun/local typed graph edges and 1,000 in-corpus directional witnesses. The [full authored YAML export](../../tools/atd-40-source-evidence.ts) preserves statements/terms/exceptions for independent inspection, not automated admission. The [read-only ledger checker](../../tools/atd-40-verify-ledger.ts) checks exact graph witness completeness, authored YAML IDs and three source SHA256 locks.

## Six actual cross-source disputes — independent decision required

| Source rule with unresolved row | Competing authored evidence / reason | Safe status |
| --- | --- | --- |
| [`planner.artifact-naming.validation-rules`](./ATD-29-SEMANTIC-BATCH-04.md) | Contract JSON Schema `$id` prescribed with `urn:contract:` prefix vs [`planner.artifact-naming.schema-identifier`](./ATD-29-SEMANTIC-BATCH-04.md) specifying clean `$id` without that prefix | Reviewer determines lineage and applicable schema form; cannot silently rewrite a convention |
| [`planner.component.structure`](./ATD-29-SEMANTIC-BATCH-05.md) | Mixed dot/colon component URN description vs [`planner.component.urn`](./ATD-29-SEMANTIC-BATCH-05.md) six-colon grammar | Unresolved source conflict |
| [`planner.user-system-flow.dependencies`](./ATD-29-SEMANTIC-BATCH-09.md) | Numeric-prefix dependency URNs vs [`planner.user-system-flow.naming`](./ATD-29-SEMANTIC-BATCH-09.md) typed subject/name URNs | Unresolved source conflict |
| [`planner.user-system-flow.participants`](./ATD-29-SEMANTIC-BATCH-09.md) | Participant statement says `capability:`; terms/regex allow `product capability:` | Unresolved mismatch; do not silently add aliases |
| [`planner.user-system-flow.theme-orchestrator-urn`](./ATD-29-SEMANTIC-BATCH-09.md) | Theme-prefixed Python orchestrator URN source versus current typed user/system-flow identity/flat source plan | Independent legacy/current-stack boundary ruling needed |
| [`tester.test.no-self-skip`](./ATD-29-SEMANTIC-BATCH-07.md) | Statement prohibits `.failing`, source terms exempt it, `tester.red.fails-first` accepts the marker | Unresolved own-source contradiction |

These six are genuine source conflicts, not 6 missing inspections. None grants authority to change canonical conventions or silently override them. The owner/source steward must decide any convention changes through the governed proposal path; Pass A preserves evidence only.

## Cross-profile reconciliation candidates — keep independently varying aspects visible

**A. Acceptance and code-to-test proof.** Planner outcome shape `PA-P-OUT01`, acceptance identity/route/telemetry `PA-P-ACC06/07/08`, coder header/URN `PA-B-TRACE04/05`, tester source binding `PA-B-TEST03` / `PA-B-TRC03/04` are linked by source, **not equivalent OoCs**. A correct plan acceptance ID can coexist with missing implementation or an untested observable effect.

**B. Router declaration → actual execution → trace.** `PA-P-FR01/15/16` describes authored guarded selection/projection; `PA-B-FLOW01/02/03` concerns implemented runtime control/data separation; `PA-B-FRT02/04/05` concerns replayed tests/traces. A rule-match or selected route never establishes execution sequence, authority commit, or compliance.

**C. Telemetry plan → implementation → test.** Planner disposition/registry/ownership `PA-P-TEL01..04`, code emission/name/source `PA-B-TEL01..05`, tester event exactness and temporal order `PA-B-TMT01..05` are separately variable, with adoption-dependent scope. An emitted-looking string cannot satisfy post-commit/rollback acceptance proof.

**D. Artifact name → contract location → data-bearing behavior.** `PA-P-ART01/02/03/05`, `PA-P-IF02/03/04/05`, `PA-P-CAP07/08` and code-side DTO `PA-B-DTO01/02/03` are distinct. Spelling equality, source path, resource instance, registry membership, version and runtime transport need independent evidence; there is a six-row source conflict on the schema `$id` spelling.

**E. Two different tracker obligations.** The original local `C-06a` external tracker issue/branch PR references and `PA-P-PLAN02` internally bound local ATDD plan issue are different bearers. Do not collapse into one “issue present” state, and do not let a passing GitHub tracker check silently ratify a PLAN.

**F. Coach/workflow and authority.** Coach action tier `PA-C02`, agent role boundary `PA-C04`, provider selection `PA-M03`, Flow message receipts `PA-F01`, task responsibility `PA-F02` and seat continuity `PA-F03` vary independently. An acknowledgement is not a task completion, and no model message is direct owner approval.

**G. Documentation consumer scope.** `PA-P-DOC03/04/09` are authored Bun documentation obligations with scoped validators. The pi-atdd toolkit's historical Markdown docs do not *automatically* create an exemption, and a repo doc-format rule cannot be assumed to apply to every unrelated consumer without profile evidence.

**H. Feedback/SMOKE proof.** `PA-P-FEA04` / `PA-B-SMK01/02` separate producer/consumer feedback declaration, real-collaborator execution and operator-observable postcondition. An inline suppression is a dated exception that must be tracked, not an approval or proof of closure.

These are **reconciliation hypotheses and required negative controls**, not Agent A decisions to canonically merge or split admitted identities.

## Original ATD-29 acceptance contract — author evidence vs independent verification

| Original criterion | Present Agent A evidence | Independent standing |
| --- | --- | --- |
| **Acceptance-01 — Complete source accounting** | **376/376** original YAMLs assessed, 339 candidate-bearing / 31 reasoned negative / six explicit source disputes, original digests and exact graph witnesses | **PARTIAL until independent source reviewer checks dispositions and source spans**; no default uninspected rows |
| **Acceptance-02 — Reproducible candidate uses and state definitions** | Each reviewed source row points to pinned YAML and a direction-neutral bearer/state, manifestation/measurement path and negative control; 290-label index retains support | **PARTIAL / independent reproducibility UNVERIFIED**; source claims of measurement are not actual consumer-state proof |
| **Acceptance-03 — Duplicates and independently varying composites** | 290 provisional labels, 42 with multiple source witnesses; source-preserving duplicates and cross-profile separations documented; six disputed source meanings kept visible | **PARTIAL**, independent identity consolidation/variation adjudication pending |
| **Acceptance-04 — No admission/direct actionability** | Candidate/index statuses explicitly `PROVISIONAL_NOT_ADMITTED`; no canonical registry or runtime changes | **UNVERIFIED independently** until reviewer audits all declarations |

**Process boundary:** This is Agent A Pass A, not Pass B O1–O8 or Pass C owner reconciliation. It is ready **to be submitted for independent review once current-head CI/repro checks pass**; it is not authorized for canonical OoC admission or T9 realization publication. A branch can pass TypeScript and still fail semantic assessment. Any actual source rule conflict should be decided by its owner, never fixed in this extraction PR.

## Reproducible checks and no-go

Use the repository's existing `npm run check`, `npm run smoke:catalog`, `npm run smoke:pi`, tracker checker, and read-only `node --experimental-strip-types tools/atd-40-verify-ledger.ts`. The new `tests/atd-29-full-corpus.test.ts` checks all batch source links/standing and exact 290-label index, not semantic correctness; it must fail on missing row/wrong label/unsupported standing or generic unresolved. `tests/atd-29-semantic-batch.test.ts` provides focused batch 01/02 invariants. **Do not claim these checks passed before the actual PR-head CI.**

Submit only a **draft PR targeting `integration/atd-39-ooc-activation`**, not `main`. ATD-39 coordinator intake, source-corpus independent review, ATD-28/27 and owner decision remain separate. Never change canonical Bun/Flow/local convention YAML, canonical OoC registry, T9 published schema, authority semantics, or execute an unauthorized Action.
