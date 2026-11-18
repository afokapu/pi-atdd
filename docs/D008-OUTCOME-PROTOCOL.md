# PLT-69 / D008 — Decision effectiveness (MANDATORY, not yet verified)

**Current D008 result: NO VALID EFFECTIVENESS COMPARISON.** A real two-agent Qwen2.5-Coder-0.5B paired Pi/JJ smoke was executed on 2026-11-18 with and without `pi-atdd`, but neither coder nor reviewer executed a Pi tool in either condition. Neither condition changed source or cleared the independent acceptance (1 pass / 2 fail). It is **UNQUALIFIED_TOOL_USE**, not proof of an improvement or regression. See [pilot report](../experiments/weak-model-pi-jj/REPORT.md) and [controlled run](https://github.com/afokapu/pi-atdd/actions/runs/44305368083). The existing tests/effectiveness.test.ts uses *fixture worktrees* to detect false claims and does not establish model effectiveness.

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

## Stage 0 — real tool-use qualification and valid comparisons (2026-11-18 correction)

Before running D008 outcomes, qualify each model/provider/transport with a **separate, unscored** Pi task that requires an actual read and tool-mediated file edit or shell action. Verify top-level Pi `tool_execution_start` and `tool_execution_end` events **and** the corresponding filesystem/test effect. JSON-shaped text that merely *describes* a tool call is not an execution. Record the exact API mode, model revision/quantization, context/completion budgets and runtime version; a response of one completion token is an invalid configuration, not a model-quality score.

For every *scored* trial, independently establish:

- A real Pi coder tool execution; a real reviewer inspection/test execution; source/revision effects attributable to the agent, not to the setup script. Report absence of each separately.
- Identical **immutable base commit**, evaluator-owned acceptance manifest and test targets, instructions apart from the graph intervention, model/settings and tool permissions across graph/control; randomized or counterbalanced condition order and isolated agent contexts. Two separately initialized but byte-equivalent fixtures with different commit identities are not an exact-base D008 pair.
- Proof that the graph condition **actually delivered** the intended source-locked rules before the relevant decision; log rule IDs/digests, omitted or unknown applicable nodes, and measured injected tokens. Being installed is not proof guidance was read or followed.
- Re-runnable independent tests and a blind, authenticated behavioral review of both outcomes; tool counts, non-executed tool requests, changed files, failures, attempts, wall time and context/tokens for both conditions.
- Repeated matched scenarios for both weak and strong models, with a preregistered benefit threshold and the complete set of negative or invalid outcomes. Do not choose, discard or change acceptance cases based on graph-vs-control results.

**Validity categories:** `INVALID_HARNESS` when model, base/fixture, runner or JJ premises fail; `UNQUALIFIED_TOOL_USE` when either condition cannot perform real Pi tool execution; `TOOL_USE_OBSERVED` for a qualified exploratory smoke only; and **D008 NOT ESTABLISHED** until independently attested, equal-base weak/strong outcome pairs have been reviewed. A zero-tool pair is not scored as a graph tie or a negative effect. Replace the 0.5B transport/model with the *smallest verified tool-call-capable* candidate before claiming a meaningful comparison; do not assume any particular small model qualifies without a witnessed probe.

The exploratory `experiments/weak-model-pi-jj/assess.mjs` emits `pair-validity.json` from actual Pi JSONL and JJ/test summaries. Its successful execution means **the instrumentation ran**, not the agents completed the task. The existing 2026-11-18 pilot is retained as a negative feasibility result; no historical result is upgraded to D008 evidence.

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

D008 is **NOT SATISFIED**: a real but unqualified 0.5B Pi smoke ran, and no authenticated, matched weak/strong agent-effectiveness trial has established a result. A real evaluator must first approve the manifest and balanced trial protocol, then run independently held acceptance and blind semantic review before any effectiveness conclusion.
