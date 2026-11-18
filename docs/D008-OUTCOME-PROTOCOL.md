# PLT-69 / D008 — Decision effectiveness (MANDATORY, not yet verified)

**Current result: NOT RUN for actual agent models.** This file is a reproducible experimental protocol, not a fabricated benchmark. The existing tests/effectiveness.test.ts uses prepared *fixture worktrees* to verify that the scoring harness catches a false claim of passing tests. It does **not** run weak or strong agents and cannot establish a benefit from graph guidance.

## Hypothesis and control

An automatically activated, provenance-backed convention graph should improve the fraction of genuinely accepted changes made by coding agents relative to the same model with no graph reasoning injected, while not increasing false-green claims or causing unacceptable regressions. The independent evaluator must distinguish behavioral success from syntactically valid test headers or an agent's self-assessment.

Run fixed tasks at the exact same base revision under these conditions:

| Dimension | Control | Graph |
|---|---|---|
| Agent | Exact pinned model ID, provider, thinking and budget | Same exact model settings |
| Context | Task and source; no pi-atdd reasoning injected | Same task/source plus automatic fact-derived ATDD guidance |
| Tooling | Same Pi, permitted commands, package versions | Same tools and version |
| Workspace | Isolated JJ/Git worktree at identical base | Independent isolated worktree at same base |
| Tests | Identical independent acceptance/CI gates | Same independent gates |
| Review | Blind reviewer judges assembled behavior from intent | Same reviewer rubric |

Run both conditions for a designated weaker and stronger model, with the starting order randomized and no copying working state, messages or previous feedback between conditions.

## Fixed first set of Bun/Flow situations

- **Security:** A protected TypeScript route introduces a mutation. Rule coder.bun.security-missing-auth. A genuine negative authorization test must fail insecure code even if it carries a syntactically valid acceptance marker.
- **Architecture:** A domain module gains an outward import. Rule coder.bun.design-hierarchy-import. Compare real dependency flow, not only directory names. A logically equivalent implementation requires independent approval, not a model waiver.
- **Test truthfulness:** A test names an acceptance but asserts unrelated behavior. Rule tester.bun.acceptance-binding-declared; check that observable behavior is actually proved, not merely that the header resolves.
- **Coordination:** A driver resumes after a coordinator integration head moved. Rule atdd-workflow.workflow.lifecycle and related collaboration policy. The JJ exact-head validator must reject the stale base (implement after PLT-66; do not simulate a passing runtime integration now).

Each task must have its own immutable GWT acceptance, negative witness, and independent reviewer rubric. Record the exact acceptance URN and source digest. A run with a missing graph dependency or unsupported tooling is marked **INCOMPLETE**, not dropped.

## Required evidence per trial

Record: task ID, acceptance IDs, model ID/provider/tier, base revision, output revision, Pi session/run ID, graph condition and digest, injected token count, wall-clock latency, tool-call count, independent test targets/results, the independent reviewer principal/verdict and evidence references. Do not infer principal authentication from a Linear comment's username prefix.

The TypeScript src/effectiveness.ts API re-runs the named tests in each result worktree and checks the immutable Git HEAD against the claimed output revision. A false "tests passed" claim is recorded as falseClaim=true when execution fails. The comparison reports pass delta, wall-time delta and token delta. A fixture cannot count as a real model run, and records lacking external review/transcript evidence cannot be treated as independently confirmed. Human or authenticated review still must inspect semantic intent.

## Completion gate

D008 stays **NOT RUN / FAIL TO ESTABLISH IMPROVEMENT** until a balanced, externally verifiable weak/strong model comparison is collected. The review must publish both negative and positive outcomes, changes in correctness, missing requirements, false-green claims, tool/retry counts, elapsed time and injected tokens. Do not choose an acceptance threshold after looking at results; set the minimum beneficial outcome in a separate reviewed decision before the trial.

This experiment does **not** authorize changing canonical YAML, weakening merge-required tests, or retiring ATDD-Bun/Flow. CI passing the scoring harness proves the harness works against fixtures, not that either model improved.


## Reviewer-mandated acceptance manifest integrity (PR #2 review 5954595568)

The evaluator must provide the acceptance oracle independently of the coding agent:

- manifest schema pi-atdd/acceptance-manifest/v1 with task ID, base revision, acceptance IDs, exact test targets, policy SHA-256, test runner, and an explicit allowlist of implementation files that the agent may change;
- a trusted evaluator adapter validates the manifest and its SHA-256 digest. A string in a model transcript or Linear comment is not authentication;
- verifyTrial(trial, manifest, trustedAuthority) rejects trial-selected targets that differ from the evaluator's targets, wrong task/base, dirty worktrees, unapproved changes to **any** tracked file, and absent evaluator acceptance targets at base;
- files outside the allowlist are immutable for D008, including tests, test fixtures and imported helpers. A model changing the test-helper implementation to make an unchanged test pass is rejected;
- compareTrials() requires identical attested manifests, acceptances, targets and policy digest for both baseline and graph conditions. Different tests cannot yield a comparable effectiveness delta.

The strict change allowlist is intentional for the *fixed D008 scenarios*. Changes outside that scope must be separately approved by the evaluator, not retroactively treated as test success. Manifest authority authentication remains unimplemented in production: the current regression tests use a synthetic verifier that exercises the boundary only.

D008 is **NOT RUN against real models**, notwithstanding passing proof-integrity regressions. A real evaluator must first approve the manifest and the balanced trial protocol, and then run independent acceptance and blind semantic review before any effectiveness conclusion.
