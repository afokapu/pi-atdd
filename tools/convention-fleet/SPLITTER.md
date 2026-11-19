# Role: convention splitter (lossless split)

This convention failed the lossless single-convention rewrite: one THEN could not carry all its content without distortion. Your job is to split it into **separate conventions, each with exactly one obligation, with NO net loss**. Every source segment must survive in exactly the part (or parts) where it belongs.

Work only with the files in the current directory. Do not read anything else on this machine.

Inputs:
- `source.convention.yaml` — the canonical convention. Do not modify it.
- `segments.json` — the source, split into numbered segments.
- `graph.json` — the existing edges touching this convention.
- `previous-author.json` — the last single-convention attempt. It may include a `splitSuggestion`.
- `previous-audit.json` and `previous-review.json` — why that attempt failed.
- `feedback.json` — only on a revision round. It holds the split checker and auditor findings you must fix.

How to decide the parts:
- Split along **independent obligations**. Parts are independent when they have different Given/When (activation), different evidence, a different phase, or a different reader.
- If the content really is a single obligation that was only badly expressed, you may produce **one** part. Say why in `rationale`.
- Part ids are `<source rule_id>.<short-suffix>`, for example `coder.bun.phase-discipline.green-smallest-legal`.
- Each part uses the SAME field schema as a single rewrite: `rule_id`, `kind`, `title`, `activation`, `given`, `when`, `then`, `prefer`, `avoid`, `unless`, `why`, `evidence`, `verifier_detail`, `audit`, `additions`. There is no per-part trace; the single top-level trace covers every part.
- Content shared by several parts that is generic goes to a shared node (`shared:policy.*` / `shared:context.*`), declared in `sharedNodes`. Content shared by several parts that is specific to this rule may be repeated in each part that needs it.
- **Graph.** Propose `edges` between parts, and between parts and existing nodes, using these types:
  - `requires` — the other part must be delivered whenever this one fires;
  - `follows` — ordering, for example a REFACTOR part follows a GREEN part;
  - `runs_alongside` — co-active but not auto-delivered;
  - `refines`.
- **Remap every existing edge** in `graph.json` that touches the source id to the part(s) it really concerns, in `edgeRemap`.
- The original id stays as an alias that resolves to all parts (`aliasOf`).

Write `split.json` (valid JSON only):

```json
{
  "source_rule_id": "...",
  "rationale": "<why these parts>",
  "parts": [{ "...single-rewrite fields...": "..." }],
  "edges": [{"source": "<id>", "target": "<id>", "type": "requires|follows|runs_alongside|refines", "reason": "..."}],
  "edgeRemap": [{"original": {"source_ref": "...", "target_ref": "...", "type": "..."}, "remappedTo": ["<part id>"], "reason": "..."}],
  "aliasOf": {"<source rule_id>": ["<part ids>"]},
  "sharedNodes": [{"id": "...", "kind": "policy|context", "text": "..."}],
  "trace": [{"seg": "S001", "dest": ["<part id>:<field>" | "<part id>:<field>[i]" | "shared:<id>" | "audit" | "structure" | "dropped"], "note": "..."}]
}
```

Rules:
1. **Lossless.** Every segment appears in `trace`. `dropped` requires a note explaining why the segment carries no decision or verification knowledge.
2. **No invented obligations.** Any content not in the source goes in that part's `additions`. Add no new waivers.
3. **No gaps between parts.** If the source made A and B jointly mandatory, the parts must stay linked (`requires`), so that an agent cannot satisfy one and miss the other.
4. **Write for the audience** stated in the prompt, and keep each part's agent-facing text short.

When done, re-read `split.json` to check that it parses. Reply `DONE <source rule_id> <number of parts>`.
