# ATD-39 — OoC governance × structural activation: integration coordination

**Status:** working coordination charter; **not** an admitted OoC catalog, an approved T9 Change Realization Contract, or production Pi governance authority.  
**Coordinator Linear issue:** [ATD-39](https://linear.app/af8/issue/ATD-39) (parent: ATD-23).  
**Repository:** [afokapu/pi-atdd](https://github.com/afokapu/pi-atdd).  
**Pinned fork source:** `main@9abc1a087db8d3d50f4e7badbd0320fe68733ca1` (2026-11-22).  
**Integration branch:** `integration/atd-39-ooc-activation`.  
**Working branches:** `feature/atd-40-ooc-governance-contract` and `feature/atd-41-structural-activation`, both based on the same integration revision.

## Ownership and issue relationships

| Seat | Delivery issue | Working branch | Source-of-truth issues | Scope |
| --- | --- | --- | --- | --- |
| Integration coordinator (this session) | [ATD-39](https://linear.app/af8/issue/ATD-39) | `integration/atd-39-ooc-activation` | ATD-23; related ATD-26, ATD-25, ATD-30 | Freeze interface, coordinate evidence, review branch intake, run independent integration checks, manage unresolved gaps and owner gate |
| Stream A / semantic contract | [ATD-40](https://linear.app/af8/issue/ATD-40) | `feature/atd-40-ooc-governance-contract` | [ATD-29](https://linear.app/af8/issue/ATD-29), [ATD-26](https://linear.app/af8/issue/ATD-26), ATD-28/27; [PLT-107](https://linear.app/forge100/issue/PLT-107), [PLT-110](https://linear.app/forge100/issue/PLT-110) | Source-pinned candidates and negative ledger; proposed T9-facing semantic/realization contract, no owner admission |
| Stream B / operational facts | [ATD-41](https://linear.app/af8/issue/ATD-41) | `feature/atd-41-structural-activation` | [ATD-22](https://linear.app/af8/issue/ATD-22), [ATD-25](https://linear.app/af8/issue/ATD-25), [ATD-30](https://linear.app/af8/issue/ATD-30) | Pre-edit/post-tool observations, typed facts, attribution, proof/retraction, bounded negative tests |

**Linear dependencies:** ATD-39 is blocked by ATD-40 and ATD-41. They do **not** block each other; independent tasks and source issue parentage remain intact. Full semantic integration is additionally gated by independent O1–O8 review, explicit owner OoC admission and approval of the realization contract, not by speculative guesses in a branch.

## Proposed boundary: what should cross between the streams

This is a **draft evaluation envelope**, not a published SDK/API or canonical ontology. Stream A and Stream B should challenge fields against real sources rather than coding unsupported assumptions.

| Origin / responsibility | Evidence or candidate fields | Constraints |
| --- | --- | --- |
| Authorized work/change provider (if present) | Desired Change Path / intent, operation, target Resource class/id and Situation, authority/source revision, explicit declaration state | A model cannot independently grant provider authority or assert a code revision |
| Stream B observability | Task/tool event id, repository revision, source path class, source/provenance identifier, positive typed facts and explicit missing/partial evidence | No invented phase or OoC; missing evidence is UNKNOWN, not 'does not apply'; reconcile changed and removed facts |
| Stream A semantic research | Candidate or admitted OoC *standing*, state subject definition, Resource bearer, measurement/evidence, source identity, proposed Change Realization Contract applicability | Candidate is not admitted; OoC is not Action and direct actuation is not presumed |
| Existing ATDD graph | Source-locked convention ID, typed normative applicability and relationship witness, mandatory `requires` closure | Never relabel `blocks`, `enables`, `runs_alongside` or possible Driver influence as mandatory dependencies |
| Pure resolution / coordinator test oracle | 0..N matched convention ids with exact proof, dependencies, source digests, and `UNKNOWN` / `AMBIGUOUS` / `NO_MATCH` / `REFUSAL` reasons | Matching does not authorize execution, admit an OoC, prove causality or establish compliance |

**Convergence question:** For a source-verified, authorized declared change and a set of independently observed facts, which *existing* conventions are applicable, by which authored predicate, with which mandatory dependencies and proof? A legitimate no-rule determination must be distinguishable from a mapping gap or incomplete evidence.

## Parallel work / handoff protocol

1. **Both workers may start immediately.** Use only the issue-specific `feature/` branch, verify its starting revision and read this file and the linked source-of-truth issues. Do not silently rewrite frozen upstream convention YAML or move original Linear issue parents.
2. **Early handshake:** Stream A shares a provisional typed field set, 2–3 contrasting source-backed candidate scenarios, and explicit unknowns. Stream B shares the actual observable facts/provenance its Pi hooks can produce, including negative controls. The coordinator maintains unresolved semantic mismatches and updates this document only after review.
3. **Independent outputs:** Stream A produces an auditable convention→candidate/no-candidate/unresolved ledger plus contract proposal. Stream B produces observer changes and reproducible activation/negative tests, with CI and runtime checks honestly labeled.
4. **PR routing:** Each worker opens a draft PR with **base `integration/atd-39-ooc-activation`**, links its delivery issue and underlying source issues, and requests independent review. Workers do not merge to `main` or into each other's branches. If the shared integration head advances, synchronize/revalidate deliberately, not with unreviewed force pushes.
5. **Integration review:** The coordinator verifies source locks, the TypeScript checker, catalog and real Pi smoke tests, typed rule proof/unknown behavior, and replayed cross-stream fixtures at actual PR heads. Every unrun check is UNVERIFIED. Integration PR evidence must not be treated as independent OoC admission.
6. **Owner gate:** No `main` merge, consumer cutover, canonical OoC publication or approved T9 API claim without separate authorized decision and independent evidence.

## Acceptance evidence checklist

- [ ] Two workers deliver issue-linked, source-pinned draft PRs to the integration base.
- [ ] Both operational and semantic evidence have positive, negative, ambiguous and incomplete-context scenarios.
- [ ] Contract comparison preserves candidate/admitted standing and the three distinct relationship families (potential Driver influence, normative ATDD edges, applicability resolution).
- [ ] Exact authored mandatory `requires` closure and proof traces match the Pi Datalog oracle for evaluated cases.
- [ ] Unknown, unadmitted, absent-authority, no-match and genuine mapping gaps are discriminated.
- [ ] Independent review, current-head CI/smoke results and conflicts are recorded in ATD-39.
- [ ] Owner explicitly authorizes any final integration-to-main decision.

## Session kickoffs (give each new session its issue)

**Stream A:** “Work on [ATD-40](https://linear.app/af8/issue/ATD-40) using `feature/atd-40-ooc-governance-contract` in `afokapu/pi-atdd`. Read this charter and ATD-29/26 plus PLT-107/110. Own evidence-grounded OoC extraction and the provisional T9 handoff contract. Do not self-admit or write runtime authority. Produce a draft PR targeting `integration/atd-39-ooc-activation` and report exact source pins, tests, unknowns and reviewer gates.”

**Stream B:** “Work on [ATD-41](https://linear.app/af8/issue/ATD-41) using `feature/atd-41-structural-activation` in `afokapu/pi-atdd`. Read this charter and ATD-22/25/30. Own conservative, typed Pi observations and activation regression evidence. Do not invent OoCs, trusted phase or semantic authority. Produce a draft PR targeting `integration/atd-39-ooc-activation` with current-head checks and explicit gaps.”

**Coordinator (this conversation):** Inspect worker Linear and draft PR updates when asked; request review, measure equivalence, reconcile only approved differences, and keep the integration branch/issue auditable. No continuous monitoring or autonomous merge is implied.


## Authoritative original issue contracts — integration acceptance update (2026-11-22)

**Correction:** The detailed original issues are not merely contextual links. Their acceptance criteria are **the conditions of completion**. Stream A is governed by [ATD-29 Acceptance-01..04](https://linear.app/af8/issue/ATD-29) within ATD-26/28/27 independent review; Stream B is governed by [ATD-22 OBS-001..004](https://linear.app/af8/issue/ATD-22) within ATD-25/30 relevant constraints. ATD-40 and ATD-41 are delivery/branch tracking wrappers **only**; they cannot narrow the original requirements.

**Linear dependency enforcement:** ATD-29 **blocks** ATD-40; ATD-22 **blocks** ATD-41; both handoff issues **block** ATD-39. Neither worker directly blocks the other. The original source issue hierarchy and detailed acceptance text are preserved. The coordinator never closes a source issue from a shortened wrapper checklist.

**Read before accepting PRs:** [Original-issue acceptance matrix](./ATD-39-ORIGINAL-ISSUE-ACCEPTANCE.md). PRs into this integration branch must provide original-criterion disposition/evidence rows. [Mechanical intake script](../scripts/check-integration-contract.mjs) and [workflow](../.github/workflows/integration-acceptance.yml) check routing and declared acceptance coverage, but **not semantic correctness**. The coordinator performs independent source, test, runtime and reviewer checks. GitHub status checks must be made required via repository branch protection separately; absent that setting, a workflow failure alone is not a merge authorization boundary.

**Current evidence, not acceptance:** Stream A [draft PR #43](https://github.com/afokapu/pi-atdd/pull/43) claims 376-file inventory but reports 362 semantically unresolved. Its original Pass A acceptance and full external validation remain open. Stream B has begun observer commits but still needs original OBS-001..004 replay/proof. No completed/approved handoff or authority claim follows from a successful branch fork.

**Worker synchronization:** Both feature branches initially forked from the coordinator charter commit `54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85`. This coordinator-only acceptance update advances the integration branch; it **does not** silently update already-running feature branches. Worker sessions should read the Linear update, refresh the integration base at the next deliberate synchronization point, and address PR-intake failures before marking work ready. No forced ref rewrites.
