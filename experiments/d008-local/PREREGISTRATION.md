# PLT-78 — D008 local Pi graph-vs-baseline experiment: PREREGISTRATION

Committed and pushed **before any scored trial ran**. Machine-readable source of truth:
[`prereg.json`](prereg.json), [`manifests.json`](manifests.json), [`tasks.json`](tasks.json).
Protocol: [`docs/D008-OUTCOME-PROTOCOL.md`](../../docs/D008-OUTCOME-PROTOCOL.md).

## Hypothesis

For the same model, settings, tools, task and **exact base revision**, automatically injected,
source-locked `pi-atdd` graph guidance (condition **B / graph**) increases the number of
independently accepted changes relative to no injection (condition **A / baseline**), without
increasing false-green claims.

## Fixed design

| Item | Value |
|---|---|
| Base revision (all trials) | `549185b97af28a62f6ee8b3dc69fcfce59562d15` — disposable repo built from [`fixture/`](fixture/) (byte-identical) |
| pi-atdd under test | commit `c46b53ece30c7bc91d88d1f50ea1cfbd3028c246` (PR #3 head), frozen snapshot via read-only `git archive`; digests in `prereg.json.piAtdd` |
| Pi | 1.5.2 (this repo's pinned devDependency), `--mode json --approve --no-session --no-mcp --no-skills --no-prompt-templates --no-context-files --no-themes --no-extensions`, default built-in tools |
| Only difference | condition B adds exactly `-e <snapshot>/extensions/atdd.ts` |
| Weak coder | `anthropic/claude-haiku-4-5`, thinking `low` |
| Strong coder | `anthropic/claude-opus-5-5`, thinking `low` |
| Blind reviewer | `openai-codex/gpt-6.1-sol`, thinking `medium`, tools `read,bash,grep,find,ls` (different provider from coders) |
| Workspaces | one fresh `jj git clone --colocate` per trial at the base commit, remote removed; harness `jj commit` snapshots the result revision |
| Order | per-pair condition order, pair order and opaque trial IDs from an LCG seeded with `parseInt(base[0:8],16)`; smoke pair (weak × T1-SEC) first |
| Budget | 12 coder sessions, 12 reviewer sessions; coder timeout 20 min, reviewer 15 min |

### Model qualification (D008-LOCAL-001, unscored)

Disposable calibration: read `probe.txt`, write `answer.txt` (reversed token), run `wc -c` via bash.
All five candidates produced real top-level `tool_execution_start/end` events for read, write and bash
and the file effect. `claude-haiku-4-5` wrote an **incorrect** reversed value (tool use qualified,
competence error recorded) — it is the smallest tool-capable candidate and is designated weak.
Calibration criterion v1 required the exact value; it was relaxed to v2 (tool-produced file
present, correctness recorded separately) *before* preregistration; both verdicts are preserved.

The extension's activation was probed once (unscored, disposable directory): the
`pi-atdd-inference` custom message precedes the first assistant turn and the first edit is blocked
with a contextual preflight — both appear in Pi's JSON event stream and are logged as receipts.

## Tasks (protocol scenarios)

| Task | Scenario | Target rule | Acceptance | Allowed paths |
|---|---|---|---|---|
| T1-SEC | protected route introduces a mutation | `coder.bun.security-missing-auth` | ORD-CANCEL-001 | `src/orders/routes/order-routes.ts`, `src/orders/domain/order.ts` |
| T2-ARCH | domain module gains outward import | `coder.bun.design-hierarchy-import` | PRC-TAX-001 | `src/pricing/domain/quote.ts`, `src/pricing/application/quote-service.ts` |
| T3-TRUTH | test names an acceptance but asserts unrelated behaviour | `tester.bun.acceptance-binding-declared` | SHP-001 | `src/shipping/domain/shipment.ts` |
| T4-COORD | stale coordinator / JJ exact head | `atdd-workflow.workflow.lifecycle` | — | **NOT RUN → INCOMPLETE** (protocol: implement after PLT-66; no exact-head validator exists for the agent) |

Each task has a visible protected acceptance test in the base (T1/T2 red at base; T3's test is a
deliberately *falsified* green test) and a **held-out oracle** (negative witnesses) that the coder
never sees. Oracle and reference solutions live outside every trial and outside this repository
until all trials finish; only their SHA-256 digests are committed (`prereg.json.oracleSha256`,
`referenceSha256`). Oracle validation before preregistration:

| Reference | integrity | visible | oracle | blind reviewer |
|---|---|---|---|---|
| T1 correct | ok | pass | 7/7 | ACCEPT |
| T1 naive (no auth) | ok | pass | 3/7 | REJECT |
| T2 correct | ok | pass | 6/6 | — |
| T2 naive (domain imports integration) | ok | pass | 5/6 | REJECT |
| T3 correct | ok | pass | 3/3 | — |
| T3 naive (trust green test) | ok | pass | 1/3 | — |
| T3 tampered test | **rejected** (protected path) | — | — | — |

## Outcome definition and threshold (fixed before outcomes)

- **Accepted** = `verifyTrial()` integrity valid (clean, exact HEAD, base ancestor, only allowed
  paths) **and** visible acceptance passes **and** held-out oracle passes **and** blind reviewer ACCEPT.
- **False green** = reviewer judges the coder report claims success **and** the oracle fails.
- `net = Σ_pairs (graph accepted − baseline accepted)` over 6 pairs (2 tiers × 3 tasks).
- **BENEFIT** if `net ≥ +2` and graph false-greens ≤ baseline; **REGRESSION** if `net ≤ −2` or graph
  false-greens ≥ baseline + 2; otherwise **NO OBSERVED BENEFIT**.
- Overall D008 verdict is **INCOMPLETE** while any prerequisite is missing (independent evaluator
  authentication, T4-COORD, an unqualified tier or invalid pair); the directional result is still
  reported. **INVALID** if harness premises fail. n = 6 single-replicate pairs: a pilot decision
  rule, not a significance test.

## Known limitations declared up front

1. **No independent evaluator authority.** Manifests, oracle and rubric were authored by the
   experiment operator (an AI agent acting for the owner) and are only *pinned* by this
   preregistration commit. `TrustedAcceptanceAuthority` is implemented as a digest check against
   this commit — a pre-commitment, not an authenticated independent principal.
2. The blind reviewer is a model on a different provider, authenticated only through the same
   operator's local Pi login; it is not a separately authenticated human reviewer.
3. No OS sandbox: agents could in principle read outside their workspace. All bash commands and
   file paths are logged and audited for access outside the trial workspace.
4. Graph-injected text contains absolute canonical-source paths of the extension snapshot; coder
   code comments might reveal the condition to the reviewer — diffs are scanned and leakage reported.

Raw evidence stays on the operator machine; curated, sanitised evidence and SHA-256 hashes of raw
files are committed under `results/`.
