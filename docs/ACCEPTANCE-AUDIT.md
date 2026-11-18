# PLT-64 — Adversarial acceptance review (author self-audit)

**Authority:** [PLT-64](https://linear.app/forge100/issue/PLT-64) with seven Given/When/Then criteria. The source-of-truth acceptance files are in `plan/acceptances/`, structurally validated against the unchanged [ATDD-Bun V2 acceptance schema](../tests/fixtures/schema/acceptance.schema.json) and its [appendix schema](../tests/fixtures/schema/appendix.schema.json). This report is an author review, **not independent approval**.

**Corrected scope:** TypeScript runtime, tests and CLI only; canonicals are [ATDD-Bun](https://github.com/afokapu/atdd-bun) and [ATDD Flow](https://github.com/afokapu/atdd-flow). The original Python-first code and test fixtures were removed before this review.

| Criterion | Evidence | Status / gap |
|---|---|---|
| AC-UNIT-001 — real Pi install/discovery | `tests/pi-rpc-smoke.ts` loads the extension through Pi RPC; `tests/pi-install-smoke.ts` uses `pi install <local-package>` in an isolated HOME then starts Pi **without -e** and requires its registered `atdd` command; TypeScript typechecks against the Pi SDK | **PASS for local package installation and Pi RPC discovery in CI**; the packaged catalog also resolves without a consumer config or network via tests/bundle.test.ts. Remote Git installation and every supported host remain untested |
| AC-UNIT-002 — Bun/Flow canonical conventions and graph | `tests/catalog.test.ts` exercises unchanged copies of Bun and Flow conventions and authored edge types; `tests/full-catalog-smoke.ts` loads the complete version-pinned upstream roots | **PARTIAL**. All 356 Bun + 2 Flow original convention files and 508 relationships are now bundled unchanged in vendor/; bundled SHA locks match pinned upstream source in CI. **44 external graph references** still lack a loaded target; rule applicability and conflict handling are not exhaustive |
| AC-UNIT-003 — context-on-demand | `extensions/atdd.ts` + `tests/catalog.test.ts`: real resolver invoked on task-start and pre-edit; one-shot newly relevant rules, deduplication and unknown-path behavior | **PARTIAL**. Bundled selectors now operate automatically in trusted Pi projects with no local configuration, and additional rule/selector files can be loaded offline. Activation still covers only selected rules; edits via bash/custom tools or dynamically generated files can evade pre-edit activation. Neither hook-based guidance nor model behavior is an independent correctness gate |
| AC-UNIT-004 — graph integrity | Negative cases for source hash drift, duplicate YAML fields, dormant selector typo and unresolved mandatory dependency in `tests/catalog.test.ts` | **PASS on current fixtures and bundled SHA-256 parity tests**; full graph closure still has 44 external edge references, and changing upstream source version requires explicit review |
| AC-UNIT-005 — TypeScript test verification | `src/verify.ts`, `src/cli.ts`, `tests/verify.test.ts`; passing target, unrelated failing target, traversal/option injection, timeout; scrub inherited `NODE_TEST_CONTEXT` to prevent false green | **PASS on explicit Node tests**; Bun runner remains unexercised and test-impact selection is not implemented |
| AC-UNIT-006 — adversarial migration inventory | [MIGRATION-LEDGER](MIGRATION-LEDGER.md), [CONVENTION-CANDIDATES](CONVENTION-CANDIDATES.md), [ADVERSARIAL-TEST-PLAN](ADVERSARIAL-TEST-PLAN.md), original Flow lifecycle and Bun review conventions | **PARTIAL**. Source modules have been classified, but a rule-by-rule code-versus-YAML audit with examples and detection equivalence is not complete; PLT-65 owns exhaustive audit |
| AC-INTEGRATION-007 — CI/review boundary | GitHub Actions performs TypeScript typecheck, unit tests, schema validation, upstream corpus smoke and actual Pi RPC discovery. Draft PR #1 cannot be merged as part of this author's work | **PARTIAL**. Typecheck, Given/When/Then schema checks, explicit acceptance-to-test bindings, TypeScript tests, full Bun/Flow source loading, real Pi RPC and isolated local installation passed together in [CI run 44225118198](https://github.com/afokapu/pi-atdd/actions/runs/44225118198). No independent review was recorded |

## Adversarial findings from the corrected implementation

1. **False-green runner discovered and fixed.** Inside a Node test-worker process, child `node --test` inherits `NODE_TEST_CONTEXT`, silently skips tests, and can exit 0. Explicitly strip it from the child environment; keep a failing-target regression test.
2. **Broken wildcard matching discovered and fixed.** A glob replacement altered inserted regex syntax; replaced with a single-pass parser. Keep nested and direct path tests.
3. **Scope mismatch corrected.** Earlier version implemented Python/pytest and referenced `atdd-extensions` samples. The active runtime now uses TypeScript and ATDD-Bun/Flow fixtures.
4. **Acceptance schema dependencies were missing.** Added the referenced appendix schema before declaring GWT documentation valid.
5. **Applicability is not enforcement.** A weak agent can ignore context, retry a blocked edit without reading, or use shell commands. Mandatory CI and independent behavioral review remain necessary.
6. **Missing graph endpoints exist upstream.** Bun's relationship graph refers to conventions outside the two selected catalogs. Resolver reports unresolved references and rejects an activated, unavailable required rule; no silent invention.
7. **Flow's handover policy and runtime prompt differ.** The written lifecycle aims for same-session compaction, while the current threshold prompt instructs otherwise. Do not port either without deciding the current operative contract.
8. **Ratchet semantics differ.** ATDD Python count baselines and Bun exact-base fingerprints are distinct. The new extension must not conflate them or introduce silent policy downgrades.

## Author review verdict

**RETURN / NOT READY FOR INDEPENDENT REVIEW until each acceptance has a passing, relevant witness at the final PR revision and the unresolved items are either implemented or explicitly transferred to a follow-on task without misrepresenting PR1 completion.** Never translate a green fixture test into proof of complete ATDD Flow/Bun migration.

### Outstanding checks before reviewer request

- Complete source-catalog smoke passed in CI at pinned ATDD-Bun and Flow commits; confirm it passes at the final revision.
- Verify real Pi RPC startup on the same final commit.
- Confirm there is no Python implementation/runtime file in PR1 and the README/Linear issue specify TypeScript only (checked after source removal; retain as CI/PR diff assertion).
- Record deliberate boundaries for untouched Linear/JJ/Flow runtime behavior rather than claim replacement.
- Perform source review for model-visible prompt integrity and shell edit bypasses, and keep known limitations explicit.

## Offline catalog packaging decision

A reviewed snapshot of the unchanged Bun/Flow YAML is committed in `vendor/` and loaded by the TypeScript Pi extension automatically. It is byte-identical to the pinned upstream commits and does not require a second repository checkout, Python runtime, or internet access during rule lookup. Local `extraSources` and `extraSelectors` support additive conventions with their own SHA locks; duplicates fail. This resolves *deployment self-containment*, not the 44 unresolved external graph edges or full activation coverage.

## Independent architecture review — 2026-11-18

[PR review #5950499300](https://github.com/afokapu/pi-atdd/pull/1#pullrequestreview-5950499300) has state **COMMENTED**, not APPROVED. Its three findings are: (1) fact-driven recursive applicability instead of only keyword/path selectors, (2) full useful canonical reasoning in the Pi context, (3) lifecycle-aware supports with insertion/retraction rather than a sent-rule-ID set. It also warns that model-visible guidance is not independent verification, 44 cross-source edges are unresolved, and the two Flow nodes are not explicitly connected to Bun's authored graph.

- **Context guidance correction implemented in PR1:** `extensions/atdd.ts::explain` now sends authored fix/policy guidance excerpts, canonical file path and checksum, exceptions, linked relationship reasons, and existing implementation/detector references. Tested in `tests/catalog.test.ts`. **This is a formatting/provenance fix, not a completed decision engine.**
- **Full inference and lifecycle work OPEN:** [PLT-69](https://linear.app/forge100/issue/PLT-69/pr-2a-typed-incremental-convention-inference-truth-maintenance-and) specifies typed facts, positive recursive inference, multiple supporting derivations, retraction, unknown semantics, post-edit observation, challenges, and independent checking. It is a separate vertical slice of the same TypeScript kernel and offline catalog.
- **Review disposition remains partial:** The review did not approve the PR, and the coder does not self-certify the outstanding semantics. Do not close review threads merely because CI passed.
