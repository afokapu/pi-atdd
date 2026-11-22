# ATD-39 — Original-issue acceptance matrix

**Authority:** [ATD-29](https://linear.app/af8/issue/ATD-29) and [ATD-22](https://linear.app/af8/issue/ATD-22) are the governing detailed issue specifications. [ATD-40](https://linear.app/af8/issue/ATD-40) and [ATD-41](https://linear.app/af8/issue/ATD-41) track branch/PR handoffs only. [ATD-39](https://linear.app/af8/issue/ATD-39) coordinates and independently reviews. The original criteria are **not superseded** by shorter A-01…A-05 or B-01…B-05 checklists.

**Branch topology:** `main@9abc1a087db8d3d50f4e7badbd0320fe68733ca1` → coordinator charter commit `54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85` → `integration/atd-39-ooc-activation` → the two `feature/atd-40-ooc-governance-contract` and `feature/atd-41-structural-activation` branches. Each PR targets integration, never `main`.

## Canonical acceptance versus handoff progress

| Stream | Original acceptance | Required evidence before original issue can be completed | Coordinator finding as of 2026-11-22 |
| --- | --- | --- | --- |
| A | ATD-29/Acceptance-01 | Source-locked full non-fixture corpus; all authored rule statements, terms, exceptions, graphs inspected; candidates, source-justified no-candidates or explicit unresolved; actual denominator reproduced | **PARTIAL** — [draft PR #43](https://github.com/afokapu/pi-atdd/pull/43) reports 376 source files inventoried, **362 semantically unresolved**; historical estimate was 375 |
| A | ATD-29/Acceptance-02 | Reproducible candidate state boundaries, source spans, real governed use, bearer class and evidence/measurement paths | **PARTIAL** — 13 candidate-bearing files reported; no independent full-corpus review |
| A | ATD-29/Acceptance-03 | Source-preserving deduplication, variation conflicts and independently varying composite concerns | **UNVERIFIED** |
| A | ATD-29/Acceptance-04 | DoC/Clarifier used as extraction evidence, no automatic OoC admission/direct actionability | **UNVERIFIED** independently; draft PR disclaims admission |
| B | ATD-22/OBS-001 | Pre-edit domain→integration import facts for edit/write/supported bash, negative controls and correct rule activation | **UNVERIFIED** — worker branch has commits; current-head integration review not run |
| B | ATD-22/OBS-002 | Replay all available `fires` and `doesNotFire` sidecar examples, with explicit failures and coverage denominator | **UNVERIFIED** |
| B | ATD-22/OBS-003 | Without authorized phase provider, phase remains UNKNOWN; never inferred from task/chat language | **UNVERIFIED** |
| B | ATD-22/OBS-004 | Validator findings carry detector/file provenance and activate only for REFACTOR/reviewer consumers | **UNVERIFIED** |

Other authority gates: ATD-26 retains the independent ATD-28 O1–O8 review, ATD-27 reconciliation and owner admission. ATD-25 retains typed truth-maintenance and explanation requirements; ATD-30 retains telemetry/structural-discovery scope and measurement limits. No partial stream result can waive them.

## Mechanical PR intake (does not prove compliance)

The coordinator branch carries [`check-integration-contract.mjs`](../scripts/check-integration-contract.mjs), [regression tests](../tests/integration-contract-check.test.mjs) and [GitHub Actions intake](../.github/workflows/integration-acceptance.yml). This enforces expected PR branch/base, issue references, a common original branch ancestor, and **one evidence/disposition line per original criterion**.

PR body must include, for example:

```markdown
ATD-40 ATD-39 ATD-26 ATD-29
- ATD-29/Acceptance-01: PARTIAL — evidence: docs/ATD-40-PASS-A-LEDGER.tsv; 362 semantically unresolved
- ATD-29/Acceptance-02: UNVERIFIED — reason: independent semantic reviewer pending
- ATD-29/Acceptance-03: UNVERIFIED — gap: duplicates not fully reconciled
- ATD-29/Acceptance-04: UNVERIFIED — reason: independent validation pending
```

Stream B uses `ATD-41 ATD-39 ATD-22 ATD-25 ATD-30` plus `ATD-22/OBS-001` through `OBS-004`. **PARTIAL, UNVERIFIED and FAIL are valid honest disclosures, but not merge-ready dispositions.** A machine result of SELF_DECLARED_COMPLETE only means the metadata names all criteria and claims PASS with evidence pointers. This is not a real verification result; the coordinator must independently inspect source content, run checks at actual head revisions, confirm rule traces, and obtain required review and owner approval.

**Operational limitation:** The CI job can fail a PR but cannot itself guarantee GitHub prevents merging until the repository administrator enables required status checks and independent-review branch protection. Until then ATD-39 coordinator must manually refuse acceptance of incomplete criteria. The existing feature branches remain untouched; GitHub base updates do not magically propagate into them. Workers must synchronize deliberately and rerun checks.

**No-status-laundering:** Do not mark the original ATD-29 or ATD-22 complete simply because the delivery wrapper has a draft PR or green unit tests. Likewise, no automatic admit of engineering OoCs, publication of T9 contracts, cutover, or merge into `main`.
