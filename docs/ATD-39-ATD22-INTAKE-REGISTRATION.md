# ATD-39 — Exact-fork intake registration for ATD-22 follow-up

**Coordinator issue:** [ATD-39](https://linear.app/af8/issue/ATD-39).
**Source owner:** [ATD-22](https://linear.app/af8/issue/ATD-22) (OBS-001..004).
**Delivery history:** [ATD-41](https://linear.app/af8/issue/ATD-41) / [PR #44](https://github.com/afokapu/pi-atdd/pull/44) is an intermediate integration checkpoint, not source-issue completion.
**Active source implementation:** [Draft PR #50](https://github.com/afokapu/pi-atdd/pull/50).

## Provenance and scope

- The only newly registered worker ref is `feature/atd-22-observer-acceptance-followup`, anchored to exact staged integration fork `567b2e513782b380c18f320d69edf140d61a36d4`.
- The only newly registered coordinator ref is `feature/atd-39-register-atd-22-followup`, anchored to exact current integration fork `9792560103f1a13f34bf8a3f1620342c04158616`.
- GitHub Actions still checks `git merge-base --is-ancestor`. Arbitrary names, forks and main-based workers remain rejected.
- Original four `ATD-22/OBS-00N` evidence rows remain mandatory. `PARTIAL` is a disclosed outstanding obligation, never equivalent to `PASS`, permission or accepted source semantics.
- The coordination branch's own intake is expected to fail on old integration-base allow-list until this separate coordinator patch is reviewed and integrated. Do not modify worker PR #50 to bypass the gate or spoof a registered name.

## Verification and independent gate

`node --test tests/integration-contract-check.test.mjs` tests wrong base, missing criterion, missing evidence, unauthorized sibling refs and exact fork constants. The regular TypeScript/test/real Pi/catalog CI must remain green. After coordinator review and integration, rerun PR #50's intake against the *actual* current integration head; do not report source-acceptance completion from the intake linter or feature-branch tests alone.

**Disposition:** Coordinator review/owner decision open. No autonomous integration/main merge, source-issue closure or OoC admission.
