# pi-atdd 0.2.0: ATDD-Bun baseline (frozen)

This version is frozen as the **starting point** for the stack-neutral work (PLT-84). It is ATDD-Bun specific by design.

## Contents

| Area | Source | Status |
|---|---|---|
| Graph delivery fixes (PLT-79) | PR #5 (`fix/plt-79-graph-delivery` @ `67823d78`) | Draft. Reviewed by 4 blind AI review rounds; not merged to `main`. |
| Convention sidecar (PLT-81) | PR #7 (`plt-81-conventions-sidecar` @ `399f6584`) | Draft. AI-only pipeline; no human review. |
| D008 pilot-validity docs and experiments | PR #3 lineage (`c46b53ec`) | Draft |

### Graph delivery fixes (PLT-79)

- Shell writes are preflighted with the same rules as `edit`/`write`.
- Post-tool reconciliation is attached to the tool result.
- Selector terms match on word boundaries.
- Pages are relevance-ranked, so the target rule is always kept.
- Omitted rules are queued and delivered on the next tool result.

### Convention sidecar (PLT-81)

- 343 lossless Gherkin-like rewrites, plus 15 lossless splits into 46 parts. All 358 canonical conventions are covered.
- 13 shared nodes and a graph overlay.
- Everything is pinned to the source SHA-256.

## Behaviour at this version

- **The runtime does not read the sidecar yet.** Delivery still renders the canonical YAML through the PLT-79-fixed renderer. The sidecar is shipped as data, and a test enforces that it stays pinned to the canonical YAML.
- **Activation uses path, layer, operation and task-term facts only.** Diff-level `change`, `phase`, `file_kind` and detector `finding` observers are PLT-83.
- **ATDD-Bun specific.** The layer names are hard-coded, selectors use Bun paths, and 131 of 343 sidecars name the stack or the layout in agent-facing text.

## Measured effect (PLT-79, at the fix commit)

- **Acceptance:** weak models with the graph scored 17/36 against 16/36 without it (NO OBSERVED BENEFIT). The only code-level lift was on the architecture task, 3/6 → 5/6.
- **Cost and time:** both rose. Haiku went from $0.24 to $0.35 per accepted run, and from 43 s to 73 s per run.

This is a baseline, not a claim of effectiveness.

## Checks at freeze

- `npm run check`: 85/85 pass.
- `npm run smoke:pi`: pass.
- `npm run smoke:bundle`: pass.
- `npm run smoke:install`: pass.
