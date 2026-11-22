# ATD-22 — original-spec acceptance recheck after stage-only PR #44

**Original authority:** [ATD-22](https://linear.app/af8/issue/ATD-22), supported by [ATD-25](https://linear.app/af8/issue/ATD-25) (truth maintenance), [ATD-30](https://linear.app/af8/issue/ATD-30) (observation/privacy). [ATD-41](https://linear.app/af8/issue/ATD-41) was a delivery wrapper. [ATD-39](https://linear.app/af8/issue/ATD-39) owns integration and independent acceptance.

**Historical PR decision:** [PR #44](https://github.com/afokapu/pi-atdd/pull/44) was merged into the ATD-39 branch **only as a staging checkpoint**. The [coordinator review](https://github.com/afokapu/pi-atdd/pull/44#pullrequestreview-6013760045) explicitly refused to call OBS-001, OBS-002 or OBS-004 complete. A green code CI from that PR was never an original-spec acceptance decision.

**This follow-up:** [draft PR #50](https://github.com/afokapu/pi-atdd/pull/50), branch `feature/atd-22-observer-acceptance-followup` from the latest confirmed integration fork `567b2e513782b380c18f320d69edf140d61a36d4`. Its code and tests must be evaluated at the exact final feature head; CI on a previous commit does not certify subsequent changes.

## Original acceptance — evidence and exact boundary

| Criterion | Evidence implemented | Status requiring independent review |
| --- | --- | --- |
| **OBS-001 pre-edit structural change** | Existing Pi `edit`/`write`/statically quoted shell preflight plus new `src/layer-import-observer.ts` and `tests/layer-import-observer.test.ts` for every authored outward layer direction. `tests/pi-activation.test.ts` checks a real application→presentation write **before mutation**, independent of task keywords. Tests cover unchanged, same-feature, assembly, test/vendor, external, unresolved alias and unparseable source. | **PARTIAL until outside-in review.** Opaque/dynamically computed bash writes cannot yield trustworthy proposed source before execution; later repository observation must not be mislabeled pre-edit |
| **OBS-002 full sidecar fires/doesNotFire** | `tools/sidecar-activation-matrix.ts` verifies the **entire 2,579-case source-locked corpus** (359 source entries/390 variants, 718 digest checks) and still labels text-only probes unqualified. `tools/sidecar-witness-replay.ts` binds **10 independently authored actual source/diff witnesses** to the exact authored `coder.architecture.hierarchy-import` case IDs (five fires, five doesNotFire). An executable per-case report for all 2,579 is uploaded by CI under `atd22-obs002-qualified-cases`. Legacy selector overactivation is reported separately from AST source proof, never hidden. | **NOT COMPLETE.** **2,569 cases lack independent file/diff/provider/detector situations**. A natural-language sidecar sentence and a mock task string cannot establish the described source situation. Every remaining case is reported as `UNQUALIFIED_NO_INDEPENDENT_OBSERVATION`, not PASS or N/A |
| **OBS-003 trusted phase** | ATD-42's merged authenticated Flow seat/task/launch provider supplies revision-bound phase to live Pi. `src/reasoning-context.ts` rejects Pi/chat-originated phase. `tests/trusted-flow-phase.test.ts` and Pi integration tests cover source authentication and UNKNOWN. | **PASS (scoped)** if the integrated source/phase tests remain green at exact head; this follow-up does not invent a provider or grant change authority |
| **OBS-004 real validator-to-gated consumer** | `src/validator-observer.ts` runs a real TS static import/role validator over observed source, tied to detector ID, Git/JJ revision string, file, and exact-source SHA. `src/pi-activation.ts` produces a separate positive detector finding only under authenticated Flow **REFACTOR**; GREEN receives no validator finding. Clean/UNKNOWN source retracts prior support; a reintroduced violation is delivered again. `tests/validator-observer.test.ts` confirms real validation through the review reasoner, and `tests/pi-activation.test.ts` checks the assembled Pi hook boundary. | **PARTIAL pending independent reviewer.** This adapter covers static TS relative layer imports; it is not a generic adapter for every external validator, every source language or a published authorization provider |

## Convention selection and deterministic verification

The pinned convention catalog has **356 Bun + 2 Flow + 18 package-local rules**. The source-locked applicability ledger in `tools/atd-41-rule-ledger.mjs` identifies rules actually relevant to this Node/Pi feature; it does not force Bun server, `bun:test`, UI or unrelated product-plan rules onto the package. The complete 376-rule inventory is **scope evidence**, not 376 passes.

CI invokes `node tools/atd-41-quality-audit.mjs --enforce` using exactly the pinned ATDD-Bun TypeScript metric algorithms, plus AST checks for direct console calls and test `process.env` mutation/self-skips. It covers the ATD-41 baseline and this follow-up's named source, helper, validator and case-report functions. Findings block the code job; no metric threshold is weakened. Independent behavioral reconciliation remains a separate gate.

## Reproduce and inspect source evidence

```sh
npm run check
npm run smoke:catalog
npm run smoke:pi
npm run smoke:attention
npm run smoke:install
node tools/atd-41-rule-ledger.mjs --output=/tmp/atd22-rule-scopes.jsonl
# CI first checks out pinned ATDD-Bun into .cache-sources/atdd-bun
node tools/atd-41-quality-audit.mjs --enforce
node --experimental-strip-types tools/sidecar-witness-replay.ts --output=/tmp/atd22-all-case-statuses.jsonl
```

In each JSONL record, the authored rule/variant and its SHA-256 locks are retained. An `EXECUTABLE_PASS` means **that one** independently observed scenario matched, not that the rule's other examples or the entire corpus passed. Missing witnesses carry an explicit reason. The output contains only public pinned rule IDs and bounded case metadata, not private source or task contents.

**Do not merge or mark ATD-22 Done** while OBS-002 remains unqualified or ATD-39's independent original-issue checker fails during bootstrap. Coordinator integration review, approved semantics and owner authority cannot be inferred from green TypeScript tests or from this author-created evidence ledger.
