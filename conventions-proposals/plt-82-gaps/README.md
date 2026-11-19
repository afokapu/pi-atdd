# PLT-82 gap conventions — proposals (stack-neutral core, unaudited)

These are **proposals**. They are not frozen, not audited and not read by the runtime. They are kept out of `conventions-sidecar/` on purpose, so the frozen v0.2.0 baseline and its golden/hash tests stay untouched.

## Origin

PLT-82 ran a hard multi-constraint task (pay part of a pending order with credits held in expiring holdings, with idempotency, concurrency and reversal). It found traps that **no convention in pi-atdd v0.2.0** (`v0.2.0-bun-baseline`) covers.

- Coverage check: [`GAP-ANALYSIS.md`](GAP-ANALYSIS.md).
- Run evidence: branch `exp/plt-82-qual-gap`, `experiments/plt-82-qual-gap/` (`REPORT.md`, `COMPARISON.md`).

## Form (PLT-84 design)

- **Core only, written in roles.** The roles are domain, application, integration and boundary. The text names no stack, framework, file suffix or path. `realizations` is empty.
- **No stack realization yet.** Under the PLT-84 promotion rule, a realization (Bun first) is added only when agent-derived results fail on that convention. Until then, a run that receives these conventions is labelled **realization: agent-derived (unverified)**.
- **Field shape:** the same as the sidecar (`activation.facts/fires/doesNotFire`, `given`, `when`, one-sentence `then`, `prefer`, `avoid`, `unless`, `why`, `evidence`), plus `scope`, `status`, `covers` and `realizations`.
- **No `trace`:** these are new conventions with no canonical source, so there is nothing to trace losslessly. That is a real difference from the 358 audited rewrites, and a decision PLT-84 has to make (see Open items).

## Files

- `conventions/*.json` — 10 proposals.
- `author.mjs` — the single source that writes them. Edit here and re-run; never hand-edit the JSON.
- `lint.mjs` — mechanical checks:
  - schema;
  - activation vocabulary (`tools/convention-fleet` `FACT_KINDS`);
  - one-sentence THEN;
  - coder-facing size;
  - **stack neutrality**: no stack, framework, suffix or path tokens, in the spirit of PLT-84 SN-002;
  - **PLT-82 overfit**: no fixture vocabulary (orders, points, holdings, redeem, tax, discount, euro and so on) in agent-facing text.

  Status: 10/10 pass.

```bash
node conventions-proposals/plt-82-gaps/author.mjs && node conventions-proposals/plt-82-gaps/lint.mjs
```

## Before these can be used

1. **Audit.** Run them through an independent audit, like PLT-81: an auditor model judges one obligation per convention, activation scope, overfitting, stack neutrality and no new waivers, with third-party spot checks. They were written by the operator model without independent review.
2. **Validate on fresh tasks.** These rules were derived from LOY-002's failures, so **LOY-002 cannot be used to show they help**: that would be circular. Use new multi-constraint tasks, with a fresh blind evaluator that has never seen these rules, in a PLT-82-style design with more than one run per cell.
3. **Decide where the core sources live.** That means canonical YAML upstream versus core-only in this repository, and how they enter `relationships.yaml` / the graph overlay (suggested edges are in `GAP-ANALYSIS.md`).
