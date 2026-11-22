# ATD-41 / ATD-40 — Pi runtime evidence handoff

**Source implementation:** [PR #50](https://github.com/afokapu/pi-atdd/pull/50) / [ATD-41](https://linear.app/af8/issue/ATD-41), grounded in [ATD-22](https://linear.app/af8/issue/ATD-22). **Coordination owner:** [ATD-39](https://linear.app/af8/issue/ATD-39). **Semantic research:** [ATD-40 provisional T9 handoff](../research/atd-40/ATD-40-PROVISIONAL-T9-HANDOFF.md). No upstream package, source-locked convention or published T9 change.

## Correction to implementation direction

ATD-41 builds the **observation producer and evidence boundary**, not 2,579 individual convention activators, a second OoC ontology or a rule-to-OoC auto-mapping. The existing positive ATDD Datalog reasoner remains the proof oracle. An admitted, provider-governed OoC graph may later consume the observation stream only after the independent ATD-39/owner contract and review.

Before this correction, tools/atd-41-observation-envelope.ts was a standalone reference helper. It was **not called by the real Pi hooks**. The new internal source bridge and its runtime wiring are:

- [src/pi-observation-feed.ts](../src/pi-observation-feed.ts) — full typed fact arguments, stable event identity, source/provenance/revision, candidate-resource hints, missing facts, unknown states, source-locked rule/proof receipts, mandatory-only dependency witnesses, replaced support/retraction and session-reset tombstones
- [src/pi-activation.ts](../src/pi-activation.ts) — actual pre-edit, post-tool repository and REFACTOR detector observations feed the same internal in-memory boundary. A failing sink cannot block normal Pi behavior.
- [tests/pi-activation.test.ts](../tests/pi-activation.test.ts), [tests/pi-observation-feed.test.ts](../tests/pi-observation-feed.test.ts), [tests/atd-41-cross-stream-contract.test.ts](../tests/atd-41-cross-stream-contract.test.ts) — actual Pi hooks and the frozen Stream A S1–S7 contrasting situations, not natural-language task-only matching.

**Not a public SDK or T9 matcher:** The optional sink is an internal test/coordination seam. Its receipts may contain sensitive source paths or proof provenance and must never be written to sanitized telemetry. No model can use the sink to grant permissions, admit an OoC, authorize a Change Path or merge.

## Field and provenance compatibility

| ATD-40 research field | Stream B observation | Preserved limitation |
| --- | --- | --- |
| eventId, scope, factType, factArgs | Event ID/scope + full typed observed fact arguments | Original evidence identity, not task keywords |
| origin and provenance | Separate event and fact assertion origins | Pi event, repository source and detector finding never become provider authority |
| sourceRevision, sourcePath, sourceDigest | Repository revision, target hint, exact source-byte digest and proposal/repository status | Explicit proposed edit bytes are PROPOSED; target-only preflight reads are EXISTING (not proposals); post-tool reads are OBSERVED. No pre-edit HEAD attribution is invented |
| evidenceState | OBSERVED, RETRACTED, missing reasons and unknownFacts | Unobserved never means rule does not apply |
| rule applicability and normative edges | Authored convention ID/source digest, Datalog proof, explicitly typed supportKinds and traversed mandatory requires edges | LEGACY_SELECTOR stays visible and distinct from STRUCTURAL_SOURCE, DETECTOR_FINDING, TRUSTED_PHASE and mandatory closure. No word or path match becomes OoC authority |
| Resource or Situation | Source path hint and file-kind/layer evidence | Neither is an admitted OoC or authoritative Resource identity |
| desired Change Path, admitted identity, authority | Deliberately absent | To be provided through independently approved Stream A and owner semantics |
| GovernanceResult dispositions | observation_only_no_authority; reasoner-local matched/unknown/incomplete | No fabricated MATCHED, NO_MATCH, REFUSAL, execution permission, or no-rule verdict |

**Open schema discrepancy:** The ATD-40 draft example lists only pi-event, repository-observation and trusted-work-provider origins for its ObservedFact. The original ATD-22 specification independently requires detector-result findings. Stream B preserves detector-result and explicit non-assertive retraction/session lifecycle events. ATD-39 must reconcile that type union; it cannot relabel a detector result as an authorized provider.

## Verification patterns, not a rule-by-rule implementation

The tests compare the actual reasoner/feed to ATD-40 S1–S7 categories: unguarded mutation versus GET-only negative/retraction; test URN versus missing binding and reviewer truthfulness; original mandatory-only graph closure; partial source and untrusted phase; scope replacement and detector supports. Source hash and event revision remain separate, including proposed versus already observed source.

The original sidecar matrix of 2,579 examples is a coverage ledger. Only independently executable source-backed examples can claim a structural PASS; the previously reported 2,558 unqualified examples are not relabeled successful or automatically made individual Pi implementation tasks.

**Systemic merge overlap:** [ATD-42 draft PR #51](https://github.com/afokapu/pi-atdd/pull/51) also modifies the live Pi hook (src/pi-activation.ts) and its integration tests; [ATD-29/26/28/27 draft PR #52](https://github.com/afokapu/pi-atdd/pull/52) does not overlap this source. ATD-39 must rerun the Flow PLAN/RED guard and observation feed on the actual combined tree, not infer merge safety from separate feature-branch checks.

## Acceptance boundary

ATD-41's B-01..B-05 and original ATD-22 OBS-001..004 remain the governing criteria. The private feed does not replace phase-provider trust, a real validator's source receipts, or external reviewer acceptance. Existing static shell limitations and genuine semantic mapping gaps stay explicit UNKNOWN. Verify exact-head TS, unit tests, pinned Bun source metrics, real Pi and catalog smoke, and author-side systemic/systematic/adversarial checks before handing to ATD-39. Cross-stream semantic binding, OoC admission, independent reviewer approval and any integration/main merge are **ATD-39/owner-owned**, not self-approved by the Pi worker.

No source-locked Bun/Flow/local YAML, published T9 contract, NPM package configuration or upstream repository was changed.
