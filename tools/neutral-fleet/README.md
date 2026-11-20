# Neutral-core fleet (PLT-84)

Derives the stack-neutral core of a convention from its frozen ATDD-Bun sidecar, which is NOT changed.

| Step | Who | File |
|---|---|---|
| Derive core, profile requirements, `bunOnly`, classification | `pi-claude-cli/claude-opus-5-5` | `NEUTRALIZER.md` |
| Mechanical check: neutrality lint, role-level activation, full classification, **closed vocabulary** (`profiles/vocabulary.yaml`) | script | `run-neutral.mjs` (`neutralCheck`) |
| Independent audit (faithful, neutral, activation, profile keys, usefulness) | `openai-codex/gpt-6.1-sol` | `NEUTRAL_AUDITOR.md` |
| Revision rounds (max 3) | deriver + auditor | |
| Third-party review (faithful, leaks, Python transfer score) | `kimi-coding/k3.1-pro` | inline in `run-neutral.mjs` |
| Promote PASS into `conventions-neutral/` | script | `promote.ts` |
| Golden snapshots from the frozen tag | script | `golden-from-tag.ts` |

```
node tools/neutral-fleet/run-neutral.mjs tools/neutral-fleet/stage1-ids.txt --concurrency 5 --rounds 3
node --experimental-strip-types tools/neutral-fleet/promote.ts tools/neutral-fleet/runs-stage1 $(cat tools/neutral-fleet/stage1-ids.txt)
node --experimental-strip-types tools/neutral-fleet/golden-from-tag.ts $(cat tools/neutral-fleet/stage1-ids.txt)
```

Run outputs are written next to the script (`runs-stage1/`, `stage1.log`) and are not committed. The stage-1 run
is kept in the operator's evidence folder. Claude roles must use `pi-claude-cli`; `lib.mjs` refuses `anthropic`.

Known difference: the stage-1 mechanical lint did not scan `core.verification`. The repo lint
(`src/neutral-lint.ts`, used by `tests/neutral-bun-golden.test.ts`) does.
