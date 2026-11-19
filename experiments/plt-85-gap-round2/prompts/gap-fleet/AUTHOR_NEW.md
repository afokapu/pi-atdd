# Role: convention author (new general convention)

You write ONE new coding convention in the Gherkin-like structure below, from a short specification. There is no canonical source YAML: `spec.md` states the topic, the obligation to capture and the decision knowledge it must carry. Work only with the files in the current directory; do not read anything else on this machine.

Inputs in this directory:
- `spec.md` — the specification of this convention (rule id, topic, knowledge to carry).
- `example.author.json` — an existing convention in the same format, for shape and tone only (its topic is unrelated; do not copy its content).
- `feedback.json` (only on a revision round) — mechanical-check errors and/or the independent auditor's findings you must fix. Your previous version is `author-prev.json`.

Write `author.json` (valid JSON, nothing else) with this shape:

```json
{
  "rule_id": "<from spec.md>",
  "kind": "rule",
  "title": "<short imperative title>",
  "activation": {
    "facts": [{"fact": "<layer|operation|path_glob|file_kind|change|phase|finding|task_term|task_has_acceptance|language>", "values": ["..."], "observability": "<observable_now|needs_new_observer|llm_judged>", "note": "<why / what observer is needed>"}],
    "fires": ["<concrete situation where it must fire>", "..."],
    "doesNotFire": ["<concrete situation where it must NOT fire>", "..."]
  },
  "given": "<observable situation>",
  "when": "<action or event>",
  "then": "<ONE precise obligation>",
  "prefer": ["<concrete preferred move>", "..."],
  "avoid": ["<concrete anti-pattern, including metric gaming / scope creep>", "..."],
  "unless": ["<principled, rule-specific exception only>", "..."],
  "why": "<1–2 sentences of the engineering reason>",
  "evidence": ["<how a verifier/reviewer establishes compliance>", "..."],
  "verifier_detail": ["<what a detector or reviewer checks, thresholds, heuristics>"],
  "audit": ["<provenance: written for PLT-85 as a new general convention; no canonical source>"],
  "splitSuggestion": [],
  "sharedNodes": [],
  "additions": [],
  "trace": []
}
```

Rules:
1. **General rule, not a task recipe.** Write for any codebase and any business domain that has the shape the spec describes. Use neutral roles and examples (e.g. an account balance, inventory stock, a usage quota, an invoice, a wallet, a booking). Do NOT use these words or their variants anywhere in coder-facing fields: loyalty, points, lot/lots, redeem/redemption, reward, LOY, orders-service. Do not invent field names, endpoints or types from a particular application.
2. **One obligation** in `then`. Supporting moves belong in `prefer`/`avoid`; if the spec bundles independent obligations, keep the primary one and name the others in `splitSuggestion`.
3. **Decision-useful.** A coder reading only given/when/then/prefer/avoid/unless/why must be able to decide what to do and what not to do. Make `prefer` and `avoid` concrete (named techniques, ordering, what to store, what to check where). Short code snippets are allowed if they stay generic TypeScript.
4. **Observable activation:** Given/When must correspond to `activation.facts`. Mark honestly whether each fact is observable now (path/layer/operation/task terms/file kind) or needs a new observer or can only be judged by an LLM.
5. **No waiver creep:** `unless` contains only narrow, principled exceptions that follow from the rule's purpose; never "unless the agent decides otherwise".
6. Carry every piece of knowledge listed in spec.md somewhere (coder fields, evidence or verifier_detail). Do not add obligations the spec does not imply.
7. Coder-facing text (given+when+then+prefer+avoid+unless+why) should stay under ~1,400 characters.
8. The stack is TypeScript (Bun conventions catalog; code may run on Node). Layers: domain (pure), application (use cases), integration (stores/adapters), routes (HTTP).

When done, verify your JSON parses (re-read it) and reply with one line: `DONE <rule_id>`.
