# PLT-69 — Adversarial acceptance audit (author assessment)

**Parent:** [PLT-69](https://linear.app/forge100/issue/PLT-69). **Code:** [stacked PR #2](https://github.com/afokapu/pi-atdd/pull/2), based on the PR #1 branch. **Verdict:** RETURN / PARTIAL, not ready to declare all acceptance criteria complete. Do not merge PR #2 or retire the old toolkits based on typecheck/smoke tests alone.

The eight canonical Given/When/Then acceptance files are in plan/acceptances/E002-* and are checked with the unchanged ATDD-Bun acceptance V2 schema. Test source markers are structural connections; evidence below states what each test actually proves.

| Criterion | Implementation / evidence | Author status |
|---|---|---|
| D001 — automatic context | src/reasoning-context.ts, src/pi-activation.ts; tests/reasoning-context.test.ts and tests/pi-activation.test.ts demonstrate path/layer/operation facts and automatic Pi events without querying a skill | PARTIAL: real typed activation works for authored examples, but default selectors still do not cover every bundled rule; authoritative phase and role facts require future work-provider integration |
| D002 — recursive positive inference | src/inference.ts, tests/inference.test.ts: safe head variables, no negative premises, finite recursive cycle, duplicate materialization checks and bound on joins | PASS for finite positive rules in these scenarios; not a benchmark establishing Datalog as universally optimal |
| D003 — insertion/retraction and multiple supports | tests/inference.test.ts: two independent derivations, removal of one, removal of all, a recursive self-support cycle, repeated insertion and evidence changes; tests/benchmark-inference.test.ts compares incremental vs cold full-corpus replay | PASS for tested cases; benchmark is environment-dependent; no proof of all possible rule programs, and no claim of globally superior performance |
| D004 — explanation / useful guidance | src/render-reasoning.ts, tests/render-reasoning.test.ts: canonical path, source SHA, original authored guidance, mandatory relationship path/reason, trigger proof, exceptions, detector reference and bounded token-like character budget | PASS for authored fixture and bounded payload; exact token counts and agent comprehension are NOT proven |
| D005 — unknown and incomplete graph | src/reasoning-context.ts, tests/reasoning-context.test.ts: unknown trusted phase/authority, missing mandatory endpoints, 44 unresolved external Bun edge references, no invented Flow links | PASS for those negative cases; graph closure remains INCOMPLETE |
| D006 — Pi lifecycle + bypass | src/pi-activation.ts and src/repository-observer.ts, tests/pi-activation.test.ts and tests/repository-observer.test.ts: first edit, retry de-dup, new task reset, bash bypass, committed Git changes, no-repository UNKNOWN | PARTIAL: Git local observation works; JJ is best effort without parity tests, Git-ignored files and unobservable custom tool modifications remain possible, and this is not a security enforcement boundary |
| D007 — governed challenge | src/challenge.ts, tests/challenge.test.ts: immutable pending request, correct canonical digest, affected rule relationships, evidence references and no self-approved/unverified decision | PARTIAL: tested with a mocked trusted reviewer; real authenticated Linear or other external reviewer adapter is not wired; cannot waive mandatory CI |
| D008 — improved agent decisions | src/effectiveness.ts, tests/effectiveness.test.ts and docs/D008-OUTCOME-PROTOCOL.md: independent rerun catches a false-green claim, matched-pair summary tracks correct/failed tests, latency and injected tokens | **NOT RUN against weak or strong models.** Fixture-only comparisons do not prove a graph improves decisions. An actual blinded, equal-base, independently reviewed paired experiment remains a release blocker |

## Architecture and migration cautions

- The source of normativity remains the offline SHA-locked, byte-identical Bun/Flow YAML. New typed inference rules are **adapter applicability rules**, not disguised edits or authoritatively declared new relationships.
- Only **mandatory requires** relationships derive prerequisites. Other typed edges remain available as authored context but do not become new hard obligations automatically.
- A missing context fact is UNKNOWN; it cannot be inferred as false, an exception, a waiver, or a merge permission.
- Retraction over-deletes affected derivations and locally rederives from surviving extensional and unaffected positive facts; self-supporting cycles without grounded support cannot persist.
- A Pi pre-edit block can be retried or bypassed via bash. Post-tool inspection reduces missed guidance in Git/JJ worktrees; it cannot ensure correctness or supersede independently required CI and behavioral review.
- Reviewer capability checks are an interface that must be implemented by an externally authenticated adapter. A string appearing in a comment is not authority.
- D008 outcomes must be measured with authentic agent trials; do not put fabricated model improvements into the ledger or close PLT-69 because the verification harness passes.

## Review boundary

Request an independent semantic review only after code-specific acceptance cases are stable. Keep this PR a draft until D006 and D007 integration boundaries are explicit, D008 experiment results exist, unresolved graph references are governed, and the original PLT-64 branch reaches its own review boundary. A passing CI report is evidence of current test success, not approval.

## Adversarial failure discovered during implementation

The first recursive retraction regression test exposed **mutable-premise corruption**: the join evaluator stored references to its scratch match array rather than immutable copies. A later candidate could rewrite a previously recorded proof, sometimes making a live derivation appear to depend on itself. This would corrupt both explanation fidelity and reverse-dependency lineage. Fixed in src/inference.ts by snapshotting every derived support's premise array. Added a specific multi-root cyclic survival and cross-join lineage test; both pass in the corrected CI suite.

The D008 checker was also tightened to reject uncommitted worktree changes, result revisions that do not descend from the trusted baseline, and acceptance test files changed by the coding agent. A passing test run against an agent-rewritten test is not independent evidence. Write-once challenge records now verify their content-derived IDs when read and before authenticated review.

## Current verified CI

[GitHub Actions run 44279189265](https://github.com/afokapu/pi-atdd/actions/runs/44279189265) passed after the immutable-support correction, including TypeScript typechecks, unit/integration tests, the full pinned catalog, actual Pi RPC registration and local package installation. Subsequent documentation-only changes require a fresh status check at the final PR revision. **D008 remains NOT RUN with real models.**
