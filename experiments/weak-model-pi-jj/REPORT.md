# Real-model two-agent Pi + JJ smoke experiment — 2026-11-18

**Status:** Executed. Coding and independent review did **not** succeed. Deterministic JJ topology checks succeeded. This is **not** D008 model-effectiveness evidence demonstrating a benefit.

## Goal and controls

Test whether two separate Pi CLI agent processes, using a genuinely small local model, can implement and review a simple TypeScript task with the `pi-atdd` extension, directly over JJ workspaces without a Linear or JJ agent orchestration adapter. A **second controlled pair** executes the same prompts, model and tests with `pi-atdd` disabled.

- Model: Qwen2.5-Coder-0.5B-Instruct-GGUF Q4_K_M, served locally by llama.cpp b12503 via OpenAI-compatible endpoint.
- Pi: from the project's pinned `@earendil-works/pi-coding-agent`; one separate coder process, one separate reviewer process in different JJ workspaces. Both connected to the same local model server.
- JJ v0.45.1: coordinator `integration/demo`, driver exact-parent workspace, reviewer exact-delivery-parent workspace, stale-head comparison. Script created the workspaces and performed revision checks: **the model did not invoke JJ itself**.
- Independent acceptance: `formatOrderId` must normalize case/whitespace/underscores and reject punctuation-only input. One test passes and two fail on the initial committed stub. Agent is not permitted to modify tests.

## Runs and diagnostic

1. [Initial run #44303873667](https://github.com/afokapu/pi-atdd/actions/runs/44303873667) initialized two real Pi processes but the local model was misconfigured with context window 4,096: Pi sent max_completion_tokens=1. Invalid for evaluating agent competence.
2. [Diagnostic run #44304433646](https://github.com/afokapu/pi-atdd/actions/runs/44304433646) proved the one-token request limit (a separate direct model request generated >1 token).
3. [Corrected run #44304790083](https://github.com/afokapu/pi-atdd/actions/runs/44304790083) raised context to 16,384 and completion budget to 1,024. Both model replies were longer, but no real tool calls occurred; the model wrote JSON-shaped strings pretending to be tool requests.
4. [Controlled graph-vs-no-graph run #44305368083](https://github.com/afokapu/pi-atdd/actions/runs/44305368083) ran the corrected two-agent setup under both conditions, recording output and actual tool event counts. [Raw artifact ZIP](https://github.com/afokapu/pi-atdd/actions/runs/44305368083/artifacts/14427023473).

| Evidence | With `pi-atdd` | Without `pi-atdd` |
| --- | --- | --- |
| Pi coder subprocess exited | 0 | 0 |
| Coder output tokens | 82 | 32 |
| Coder input tokens | 2162 | 1463 |
| Actual Pi tool executions (coder) | 0 | 0 |
| Independent tests after coder | 1 pass, 2 fail | 1 pass, 2 fail |
| Coder source diff | Empty | Empty |
| Pi reviewer subprocess exited | 0 | 0 |
| Reviewer output tokens | 77 | 48 |
| Reviewer input tokens | 3594 | 1372 |
| Actual Pi tool executions (reviewer) | 0 | 0 |
| JJ driver based on exact `integration/demo` head | Yes | Yes |
| JJ reviewer based on delivered revision | Yes | Yes |
| Stale coordinator head detected by revision comparison | Yes | Yes |
| Main unchanged | Yes | Yes |

**Interpretation:** With and without ATDD, this 0.5B model failed to execute real Pi function/tool calls and produced fake JSON-shaped tool invocations as text. Since the control failed too, we cannot attribute the coding failure to the convention graph or quantify its usefulness. The extension increased input tokens substantially, but changed no observed behavior on this sample. The GitHub Action success only means the *harness ran and uploaded evidence*. It is not agent success.

## Architecture implication

Linear can be accessed through the existing agent-side MCP workflow; no work-management adapter has been shown necessary. JJ can be used via direct CLI tool access; a small, independently callable checker for immutable base/head, stale branch, reviewer boundaries and no unauthorized merge remains valuable. This experiment verified the JJ structural checks in **harness shell commands**, but it did *not* demonstrate agent-run JJ commands, durable Pi-to-Pi messaging, or end-to-end agent delegation.

Next viable experiment: use the smallest **tool-call-capable** model, run the same paired baseline/graph task with independently held acceptance, capture genuine Pi tool executions and revisions, and only then judge agent quality and guidance impact. Keep any real-model comparison separate from D008's required weak/strong model balanced design.

The experimental branch `experiment/weak-model-pi-jj` does not change `main`, production consumers, legacy ATDD-Bun/Flow or external task state.
