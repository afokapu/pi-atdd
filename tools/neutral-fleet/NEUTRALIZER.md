# Role: core/realization deriver (PLT-84)

You derive the **stack-neutral core** of ONE ATDD convention from its frozen ATDD-Bun rewrite. The Bun rewrite is NOT changed. It remains the Bun realization and the worked reference example for other stacks. Work only with the files in the current directory, and do not read anything else.

Inputs:
- `bun.json`: the frozen ATDD-Bun rewrite (0.2.0 sidecar). Treat it as authoritative.
- `source.convention.yaml`: the canonical source (context only).
- `feedback.json`: present only on a revision round. Fix every item.
- `rule.json`: `{ "rule_id": <the current PLT-87 id>, "legacyId": <the id inside bun.json> }`. Use `rule_id` from this file in your output.
- `vocabulary.yaml`: the CLOSED structure-profile key vocabulary. Read it before writing `profileRequirements`.

## Item ids

Number the agent-facing items of `bun.json` in this order:

1. `given`, `when`, `then`, `why` — one item each.
2. `prefer[i]`, `avoid[i]`, `unless[i]`, `evidence[i]`, `verifier_detail[i]` — one item per array element.
3. `activation.facts[i]` — one item per fact.

Use the field path itself as the item id (e.g. `prefer[2]`, `activation.facts[0]`).

## Output: `neutral.json` (valid JSON only)

```json
{
  "rule_id": "<rule_id from rule.json>",
  "core": {
    "title": "...",
    "given": "...", "when": "...", "then": "<ONE obligation>",
    "prefer": ["..."], "avoid": ["..."], "unless": ["..."], "why": "...", "evidence": ["..."], "verification": ["<stack-neutral verifier scope / enforcement, e.g. strict disposition, what a check does not cover>"],
    "activation": {
      "facts": [{"fact": "role|operation|change|phase|finding|file_kind|task_term|task_has_acceptance", "values": ["..."], "observability": "observable_now|needs_new_observer|llm_judged"}],
      "fires": ["<role-level situation>"],
      "doesNotFire": ["<role-level situation>"]
    }
  },
  "profileRequirements": [{"key": "<a key from vocabulary.yaml (parametric keys expanded, e.g. roles.domain.path) or from proposedKeys>", "meaning": "<what the core needs from the profile>", "bunValue": "<the exact Bun value from bun.json>"}],
  "bunOnly": [{"item": "<item id>", "text": "<the Bun-specific content>", "reason": "<why it has no stack-neutral equivalent>"}],
  "classification": [{"item": "<item id>", "as": ["core:<field>[i]" | "core:activation.facts[i]" | "core:verification" | "profile:<key>" | "bunOnly"], "note": "..."}],
  "proposedKeys": [{"key": "<group>.<name>", "group": "<one of the 8 groups>", "meaning": "...", "bunValue": "...", "whyNoExistingKey": "..."}],
  "neutralityNotes": "<anything that could not be made neutral, and why>"
}
```

## Rules

1. **Neutral core.** It names no stack, runtime, framework, language, package manager, file suffix or path. Use **roles** instead: domain, application, integration, presentation, boundary (route / handler / endpoint), composition root, unit test, acceptance test, e2e test, plan artifact. Anything concrete that the core needs comes from the profile, through a `profileRequirements` key.
2. **Faithful.** The core, instantiated with the Bun profile values plus the `bunOnly` items, must impose exactly the same obligation as `bun.json`. It must be no weaker (an exception or condition dropped) and no stronger (a new obligation added).
3. **Every item classified.** Every Bun item appears in `classification`, including verifier-facing items. An item can map to several targets. Generic verification and enforcement (for example strict disposition, or exclusions that only scope a check) map to `core:verification`, and a matching entry goes in the core's `verification` array.
4. **Neutral examples in Prefer/Avoid.** Keep them role-level, for example "the boundary maps a domain error to a client error". The concrete Bun example is NOT repeated in the core, because `bun.json` itself is delivered as the reference example.
5. **Purely stack-mechanical rules.** If the whole convention is stack-mechanical (e.g. "use the runtime's single lockfile"), produce the most general honest core, such as "one dependency lockfile per repository, owned by the package manager". Mark the Bun specifics as `bunOnly`. If no meaningful neutral obligation exists at all, say so in `neutralityNotes` and keep the core minimal.

6. **Closed profile vocabulary.** Every `profileRequirements[].key` must be a key of `vocabulary.yaml`. Parametric keys such as `roles.<role>.path` accept only the parameter values listed in that group's `params`. Use the key whose `doc` matches the meaning; do not create near-synonyms. If, and only if, no key fits, add the key to `proposedKeys` (in one of the 8 groups, snake_case, with `whyNoExistingKey`) and also list it in `profileRequirements`. Leave `proposedKeys` empty when nothing is missing.
7. **Not profile keys.** Per-rule severity and disposition go to `core:verification` (and the core's `verification` array). Detector, validator and finding ids of this one rule are realization details: classify them `bunOnly`, and let the core's `verification` describe the check generically. `roots.excluded` is one stack-wide list; if the Bun text defers the exact exclusion to its checker, keep that deference in `core:verification`.

When done, re-read `neutral.json` to confirm it parses. Reply `DONE <rule_id>`.
