# ATD-45 layout move: plan for owner review

Status: **proposal, nothing moved.** The mapping below is inferred from each file's header, its PLT/ATD reference and its imports. Conventions used: `shared.topology.plan-location`, `shared.topology.source-location`, `tester.topology.test-location`, `planner.feature.*`.

## Target

```
plan/pi-atdd/_pi-atdd.yaml            capability
plan/pi-atdd/<feature>.yaml           9 features (verb-object)
plan/pi-atdd/<DESIRED_OUTCOME>.yaml   outcomes; the 22 acceptances nest here, URNs unchanged
src/capabilities/pi-atdd/features/<feature>/...
tests/capabilities/pi-atdd/features/<feature>/{unit,contract,integration}/...
```

Roots come from the profile (`roots.source`, `roots.test`), not from code.

## Source mapping (37 files)

| Feature | Files |
|---|---|
| `resolve-activation` | catalog, inference, reasoning-context, structural-evidence, selector-generation, challenge |
| `deliver-guidance` | pi-activation, render-reasoning, repository-observer, shell-targets, activation-telemetry, mode, extensions/atdd |
| `manage-profiles` | profile, profile-vocabulary, vocabulary, neutral-lint, neutral-render |
| `route-attention` | attention, attention-strip, attention-routing, attention-seat |
| `manage-seats` | execution-seat, execution-lifecycle, execution-pi, seat-bootstrap, launcher, durable-lock |
| `hand-off-context` | context-handoff, busy-state |
| `bind-tracker-issue` | tracker-issue |
| `guide-coach` | coach-policy, model-tier, model-tier-cli |
| `evaluate-delivery` | effectiveness, pilot-validity, verify |
| assembly | cli |

Open points: `verify` could sit in `resolve-activation`; `mode` could be its own feature; `attention.ts` and `attention-strip.ts` mix domain and Pi wiring (split later, not in the move); `pi-activation.ts` is moved unchanged.

## Test mapping (66 files, by imports)

Per feature: resolve-activation 20, deliver-guidance 5, route-attention 5, hand-off-context 7, manage-seats 6, manage-profiles 6, guide-coach 2, evaluate-delivery 2, bind-tracker-issue 2. 13 files stay cross-cutting and need an owner ruling:
attention-rpc-smoke, context-renewal-smoke, pi-install-smoke, pi-rpc-smoke, release-install-smoke (end-to-end smoke, no single feature); conventions-sidecar, migration, post-tool-flood, real-model-fixes, release-package, test-env-isolation, tracker-ci, pilot-validity (no mapped import; or mixed features).
Proposal: smoke scripts go to `e2e/` (`tester.topology.e2e-location`), the rest to the feature they exercise (pilot-validity to evaluate-delivery, tracker-ci to bind-tracker-issue, real-model-fixes split by feature).

## Order (tests first, one mechanical commit)

1. Red test: the plan models the capability, every acceptance URN resolves exactly once, `tests/acceptances.test.ts` reads the new layout.
2. Plan files (URNs unchanged; the made-up features `bootstrap` and `review-remediation` map onto the nine).
3. `jj`-tracked move of `src/` and `tests/`, then import, `package.json`, extension entry, smoke-script and doc path rewrites. No behaviour change in this commit.
4. Add `component:` and `test:` URN headers (separate commit).
5. `npm test` and the install and release smokes green, then a new release version (owner approval to tag and publish).

Risk: installed sessions read `extensions/atdd.ts` and `src/`; they break until the new version is published and reloaded.
