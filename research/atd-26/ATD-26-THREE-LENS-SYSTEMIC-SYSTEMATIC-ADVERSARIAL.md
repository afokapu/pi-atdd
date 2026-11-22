# ATD-26 — systemic / systematic / adversarial review of ATD-29, ATD-28, ATD-27 and ATD-26

**Review date:** 2026-11-22. **Repository:** `afokapu/pi-atdd`; branch `feature/atd-29-pass-a-semantic-completion` descended **directly from `integration/atd-39-ooc-activation@567b2e513782b380c18f320d69edf140d61a36d4`**, never from `main`. **Source corpus:** `vendor/catalog.lock.json` and frozen 376 nonfixture convention YAML documents, original Bun/Flow/local rules unchanged. **Normative authority:** [ATD-26](https://linear.app/af8/issue/ATD-26), [ATD-29](https://linear.app/af8/issue/ATD-29), [ATD-28](https://linear.app/af8/issue/ATD-28), [ATD-27](https://linear.app/af8/issue/ATD-27); Decision OS [accepted ADR-082 D1/D4/D5/D17](https://github.com/forgeonehundred/decision-os/blob/main/docs/architecture/decisions/adr-20260930-082-an-object-of-control-is-the-control-semantic-join.adoc) and Storymaker [accepted ADR-20261114-001](https://github.com/forgeonehundred/storymaker/blob/main/docs/architecture/decisions/adr-20261114-001-ooc-extraction-structure-as-implemented.adoc). O1–O8 remain the only OoC admission tests; DoC/Clarifier are evidence, not additional gates.

**Critical independence disclosure:** All three analytical lenses below were performed in the **same assistant-led implementation session**. Separate files and fixed evidence provenance do **not** make Agent B and Agent C independent human/agent reviewers of Agent A. The original issues explicitly require independent B/C challenge and owner/steward authorization. We must not mark those gates PASS or declare the four issues Done without those actors. The ledger's comprehensive scope and passing CI establish mechanical/accounting closure only, not independent semantic acceptance. This is intentionally a fail-closed, auditable handoff rather than a counterfeit sign-off.

## Lens 1 — SYSTEMIC: the whole graph, source universe, adoption and approval system

The [376-rule systemic audit](./systemic/ATD-26-SOURCE-GRAPH-SYSTEMIC.tsv) covers every frozen Bun (356), Flow (2) and local (18) rule. It preserves **522 exact authored Bun/local relationship edges** and **1,000 in-corpus directional witnesses** without interpreting a `runs_alongside`, `follows`, `enables`, `relieves` or `blocks` edge as a mandatory `requires` dependency, or a normative edge as a Driver. Source graph counts by in-corpus direction: 513 out, 487 in. **293 in-corpus outgoing `requires` with effective mandatory constraint**, 5 other outgoing `requires` and 215 other-type outgoing relations. The count is an observation of the typed source, not a validated T9 policy closure.

**System-level anomalies to preserve, not auto-silence:**
- **6 authored rules without an included graph witness:** `coach.naming.instance-label`; `shared.model.escalate-after-two-failures`; `shared.model.names-only-tiers`; `shared.model.subscription-providers`; `shared.model.tier-by-role`; `coach.workflow.lifecycle`. Absence is an evidence gap, not proof these rules are waived; confirm respective graph scope and actual selector standing. This matters under `planner.relationship.no-orphan-nodes`, whose own source scope must be checked for consumer applicability.
- **44 in-corpus directional references to source graph endpoints without corresponding one of the 376 convention IDs**, across 27 distinct ref names (including two `#field` fragment-qualified targets). Some are legacy/external. **Do not create fake nodes**, silently trim the `#field` suffix or call every reference a current mandatory prerequisite. The systemic TSV records exact original path and line for each.
- **6 source-level rule contradictions**, not generic uninspected files: contract `$id`, component URN syntax, numeric versus typed user/system-flow dependency identity, flow participant prefix, legacy theme-orchestrator identity, and RED `.failing` allowance. The [verbatim source conflict matrix](./adversarial/ATD-26-ATDD-SOURCE-CONFLICTS.json) pins both sides.
- `selectors/default.yaml` explicitly declares its registry **intentionally incomplete**. No claim of complete applicability or automatic enforcement of all 376 conventions follows from source inspection, a passing Pi CI, or a 522-edge ledger.
- Different authority domains remain distinct: convention applicability; candidate state semantics; O1–O8 admission; situated Capability/Resource/authority/Situation; tentative Change Realization Contracts; and owner publication. Neither an unadmitted OoC nor a source rule may authorize an Action.
- ATD-39 integration intake is a separate coordinator-controlled gate. A worker branch may be source-correct yet rejected as unregistered. The worker must not loosen the coordinator's allow-list to hide this.

## Lens 2 — SYSTEMATIC: exhaustive per-source, per-candidate and per-gate accounting

The source audit reopened every authored YAML and records the *actual statement span*, exact verbatim excerpt and Git blob SHA in the [21 small source snapshots](../atd-29/source-spans/) plus [span maps](../atd-29/ATD-29-VERBATIM-SOURCE-SPANS-01.tsv) and [source statement evidence](../atd-29/ATD-29-SOURCE-STATEMENTS-01.jsonl). These replace the previous guessed `L6-L40` spans. The [Pass A ledger](../atd-40/ATD-40-PASS-A-LEDGER.tsv) now points to precisely observed source statement/term/exception anchors. Source bodies, not filenames, are read.

**Agent A:** 376 reviewed source documents = **339 candidate-bearing, 31 explicitly reasoned NO_CANDIDATE, 6 source conflicts**. The [290-label provisional candidate/support index](../atd-29/ATD-29-PROVISIONAL-CANDIDATE-INDEX.tsv) holds all 339 supporting source associations (some sources yield more than one label), including **42 multi-source provisional labels**; no canonical OoC identities are minted.

**Role-separated O1–O8 audit, [six systematic gate tranches](../atd-28/systematic/):** **290 × 8 = 2,320 individual source-anchored gate records**, each with status and reason (PASS/FAILED/REVIEW_REQUIRED). Gate distributions:

| Gate | PASS | FAILED | REVIEW_REQUIRED | Actual restriction |
| --- | ---: | ---: | ---: | --- |
| O1 — state bearing | 191 | 0 | 99 | Source conformance predicates may not be independent state subjects |
| O2 — admission by real use | 0 | 0 | 290 | Authored rule alone is not a real D1(c) Outcome, Source Contract, measured Trace, or accepted claim that explicitly *needs* this subject |
| O3 — context stripped | 290 | 0 | 0 | Proposed terms are phrased as Resource classes, not specific file instances |
| O4 — independent variation | 270 | 11 | 9 | Eleven clear composite candidates must split, nine need variation counterexamples |
| O5 — canonical novelty | 0 | 0 | 290 | No actual snapshot of existing Decision OS canonical keys/aliases has been retrieved from its deployed authority |
| O6 — defensible manifestation | 220 | 0 | 70 | Some proposed paths are detector or guidance predicates, not state measurements |
| O7 — coherent evidenced measurement | 0 | 0 | 290 | No reproduced comparable real reading and linked admitted record per candidate was supplied |
| O8 — direction neutrality | 289 | 0 | 1 | One provisional label may embed a directional desideratum |

**No candidate is admitted**. A repeated "REVIEW_REQUIRED" is an actual finding—missing source-proven positive evidence—not a PASS or a decision to treat 290 candidates as canonical. The source-pinned [Storymaker O1–O8 assessor](https://github.com/forgeonehundred/storymaker/blob/main/src/wagons/admit-control-objects/features/admit-control-object/application/assessment.ts) accepts uncertainty; it does not add ninth gates for directness, actor presence or executable contract. This implementation did not call a real model-gate provider or pretend deterministic heuristics were an independent adjudication.

## Lens 3 — ADVERSARIAL: try to falsify the subject, citation, measurement and authority

The [four candidate falsification tranches](./adversarial/) challenge **every one of the 290 candidate labels** using six explicitly recorded attacks per label: (1) replace the class with a specific file/Resource occurrence, (2) remove a real referring record, (3) vary proposed components independently, (4) insert a competing canonical alias, (5) remove the measurement/manifestation path and try to pass on green static tests, and (6) reverse the desired direction. These produce **1,740 explicit attack cases**. The [31 NO_CANDIDATE challenges and six disputes](./adversarial/ATD-26-NEGATIVE-CONTROLS.json) retain rule-body sources and challenge original negative judgments without silently reclassifying them. Two negatives merit renewed examination (`shared.convention.propose` and `planner.user-system-flow.production-implementation`); this is a reviewer query, not proof Agent A's negative was wrong.

**Eleven composite candidates fail O4 as authored:**
`PA-B-FLOW01`, `PA-C02`, `PA-F02`, `PA-P-ACC03`, `PA-P-ACC06`, `PA-P-ART01`, `PA-P-CAP02`, `PA-P-FEA04`, `PA-P-JNY01`, `PA-P-OUT01`, `PA-P-USF05`. These are *refused as currently merged labels*, not refused state families: split independently variable concerns, preserve their original supporting rules and run the gates on each proposed split before considering admission.

**Independent split examples that a reviewer must actually challenge:**
- `PA-P-ACC03` incorrectly combined the **acceptance harness** with **boundary-kind vocabulary**; a harness can be valid while the declared integration boundary is not.
- `PA-P-CAP02` combines **additive intrinsic footprint** and **cross-capability coupling**, which its own source explicitly calls orthogonal.
- `PA-P-OUT01` aggregates **dimension**, **direction**, **quality lens**, **context clarifier** and **document shape**—all separately variable fields. One "desired-outcome quality" object would violate O4.
- `PA-C02` combines **Coach action tier**, actual owner **authorization provenance** and **small/reversible/covered** delegated eligibility. Each can vary while the others are unchanged.
- `PA-P-FEA04` conflates declared `kind: feedback-loop` with **producer/consumer correction and measured drift convergence**; a flag alone cannot prove the loop closed.

Adversarial reviewers must also reject duplicate labels when the actual canonical registry finds an existing meaning (O5), but cannot invent a deployed registry snapshot. The negative list preserves independent source obligations even for `NO_CANDIDATE`.

## Pass C: explicit disposition for every candidate and every source

The [six Pass C candidate reconciliation tranches](../atd-27/) reconcile B findings, A source identities and adversarial attacks for **all 290 provisional labels**. The [376-row source disposition matrix](../atd-27/ATD-27-ALL-376-SOURCE-DISPOSITIONS.tsv) projects those findings back onto every original convention without dropping its negative or unresolved standing.

- **11 proposed composites REFUSED_AS_COMPOSITE_AS_WRITTEN** (must split and re-challenge, not admitted).
- **279 candidates REVIEW_REQUIRED**, due particularly to missing O2 real-use referrers, O5 actual canonical novelty comparisons and O7 comparable measurements.
- **31 source-only negatives** preserved; 2 reopened for explicit state-lens challenge.
- **6 source-authorship contradictions** preserved for governed steward resolution.
- In source-row projection, **34 candidate-bearing files support a refused composite**, 305 candidate-bearing files remain under unresolved review, 29 negatives provisionally upheld, 2 negative reopen requests and six source conflicts.
- **Zero owner-approved canonical OoCs, zero published Change Realization Contract or Action templates.** A state with no known directly executable lever can still be eligible under O1–O8; the Pass C record never makes direct actionability a ninth gate.

## Triple-check per governing Linear issue: systemic / systematic / adversarial

| Original issue and substantive acceptance | Systemic check | Systematic check | Adversarial check | Valid conclusion |
| --- | --- | --- | --- | --- |
| **ATD-29 Pass A** (4 criteria) | 376 Bun/Flow/local corpus, all 522 edges, 44 unknown external endpoints, six source-orphan witnesses | 376 exact YAML statements and source blobs, 339/31/6, 290-label support index | Prior generic spans corrected; 31 negatives challenged; six contradictory authored clauses uncovered/preserved | Agent A evidence packet ready for independent semantic verification; source-linked real-use challenge still OPEN |
| **ATD-28 Pass B** (4 criteria) | All cross-profile duplicate/compound and orphan findings remain visible | 290 × eight independent *gate fields*, source excerpt and gate reason; 2,320 fields | 11 composites refused, nine others flagged, 49 alias-neighbor cases requiring review | Evidence complete as a *same-analyst review*; **independent blinded Agent B** and O2/O5/O7 evidence NOT complete |
| **ATD-27 Pass C** (4 criteria) | 376 rules and 290 candidate mapping retained without emitting a canonical key | Each source has proposed status; each candidate has B/attack/C matrices and no invented action | Mixed subject splits, two questioned negative decisions, six conflicts; owner key/admission never forged | Full C analytical handoff for owner, **not** an independently signed C or owner-ready positive admission catalog |
| **ATD-26 parent** (8 criteria) | Distinct source/applicability/admission/authority perimeters never conflated | 376 source + 290 candidates and all 8 gates, read-only original source | Forced false PASS, canonical mutation, fabricated references and direct-action assumptions are rejected | **NOT DONE**: independent B/C reviewers, real D1(c) use + O7, novelty authority and owner gate remain |

**Acceptance status truth:** This entire packet is a comprehensive, mechanically testable **draft of review findings**. It does not satisfy the independent reviewer and owner sign-off prerequisites in the actual issue descriptions. The work must be kept **open** rather than closed by a self-authored compliance assertion. No issue's original Tension/Intervention/Measurement/Reconciliation source requirements were rewritten.

## Required actual next action before completion

Independent Agent B must reproduce every gate from the original source **without seeing Agent A's opinion**, including real record use and actual known canon. Independent Agent C must independently review A + B, split all eleven composites and reconcile collisions, negative challenges and source contradictions. Source stewards must decide whether to propose changes for six contradictions through governance without changing rules in this research PR. **The owner must explicitly sign off on accepted canonical IDs** before any registry, Perimeter or T9 publication. These are not mechanical checkboxes; they cannot be performed by the same self-reviewing agent or certified by green CI. Only after they happen may ATD-28, ATD-27 and ATD-26 be marked Done.

**Tests:** `tests/atd-26-three-lens-review.test.ts` and the prior ATD-29/40 verifier/tests enforce full counts, exact source spans, O1–O8 fields, negative/split/uncertainty status and owner-gate fail-closed behavior. Passing tests establish *provenance and refusal hygiene*, not the semantic correctness of O1–O8 judgments or independent reviewer authority.
