# Convention sidecar (PLT-81)

This directory holds Gherkin-like, decision-ready rewrites of the canonical ATDD conventions vendored under `vendor/`.

**The canonical YAML is not changed.** Each rewrite is a sidecar: it is keyed by `rule_id` and pinned to the SHA-256 of the source file it was derived from. `tests/conventions-sidecar.test.ts` fails if either of these happens:

- a canonical source changes and its sidecar has not been re-audited;
- a sidecar is edited by hand without re-running the audit.

## Status

| | |
|---|---|
| Frozen (lossless audit PASS) | **343** of 358 |
| Split losslessly into one-obligation parts | **15** sources → **46** parts (`splits/`), split audit PASS, third-party review agrees 15/15 |
| Canonical conventions covered | **358 / 358** |
| Shared nodes (policy / context, deduplicated) | 13 |
| Human review | **none yet**; the review pipeline is AI-only (see below) |

## Format (`conventions/<family>/<rule_id>.json`)

| Field | Reader | Meaning |
|---|---|---|
| `activation.facts` | machine (Datalog) | Facts that make the convention applicable. Each is labelled `observable_now`, `needs_new_observer` or `llm_judged`. |
| `activation.fires` / `doesNotFire` | machine / tests | Examples of when it should and should not apply. |
| `given`, `when` | agent | The situation and the event. |
| `then` | agent | Exactly **one** obligation. |
| `prefer`, `avoid` | agent | Concrete preferred moves and anti-patterns. |
| `unless` | agent | Exceptions authored in the source only. No new waivers. |
| `why` | agent | One or two lines of rationale. |
| `evidence`, `verifier_detail` | verifier / reviewer | How compliance is established, and detector internals. |
| `audit` | audit log | Lineage, aliases, metadata. |
| `sharedNodes` | — | Content moved to a shared `policy.*` / `context.*` node (`shared/`). |
| `additions` | reviewer | Anything not present in the source, declared with a justification. |
| `trace` | auditor | Every source segment (`S001…`) mapped to its destination. This is the lossless proof. |

`splits/<source rule_id>.json` holds an approved split: its parts, each with the same fields as above, plus `edges`, `edgeRemap`, `aliasOf`, and one `trace` covering all parts.

`evidence/<family>/<rule_id>.json` holds the auditor's per-segment judgement, plus the third-party review where one was sampled.

## How it was produced (`tools/convention-fleet/`)

1. **Segment.** A deterministic script splits the canonical YAML into numbered segments.
2. **Author.** `anthropic/claude-opus-5-5` writes the rewrite and traces every segment.
3. **Mechanical check.** Coverage, schema, activation vocabulary, overfitting lint.
4. **Independent auditor.** `openai-codex/gpt-6.1-sol` judges every segment: PRESERVED, COMPRESSED_OK, LOST, DISTORTED, WRONG_DESTINATION or a DROP verdict. It also checks undeclared additions, new waivers, activation scope and overfitting.
5. **Revision rounds.** Each round's feedback combines the auditor findings, the third-party review and any rule-specific content found inside shared nodes.
6. **Third-party spot-check.** `kimi-coding/k3.1-pro` reviews every non-PASS convention and a seeded 10% of the PASS set. It agreed with the auditor on 177 of 178.
7. **Shared-node deduplication.** Each shared node is merged and then audited for per-variant coverage.

This is an AI-only pipeline, set up by the operator on the owner's delegation. Treat the audit as a gate, not an authority.

## Known open items

- The 15 split sources propose graph changes in `graph-overlay.json`: 78 new edges, 39 remapped edges and the alias for each original id. The canonical `relationships.yaml` is unchanged, and the overlay has not been applied by the reasoner yet.
- 4 rule-specific items are still inside shared nodes (`shared/*.json → notGeneric`).
- Most activations need observers that do not exist yet (PLT-83): detector `finding`, diff-level `change`, `phase` and `file_kind`.
- The runtime renderer does not read this sidecar yet.
