# pi-atdd 0.6.0 (ATD-50, ATD-47)

This breaking release removes external (Flow-owned) seat mode and `ownsFlowExecution`. Launching with `PI_ATDD_EXECUTION_MODE=external` now fails with `external seat mode was removed in 0.6.0; start with atdd launch`. CI no longer checks out atdd-bun or atdd-flow or runs `smoke:catalog`; the vendored lock-based drift test replaces it. Idle attention refresh uses lock-free reads and a bounded wait, warning once for a stuck lock rather than warning on brief collisions.

ATD-46, ATD-37 (PR #45), ATD-49, ATD-51, ATD-52 and ATD-53 are not included.

## Licences

The [0.4.0 licence review](RELEASE-0.4.0.md#licences) records the pinned upstream revisions and evidence:

- `vendor/atdd-bun`, revision `5945d97e18310e7c862c08e73985400935d21346`: no upstream licence found at that revision; the owner approved shipping the vendored content.
- `vendor/atdd-flow`, revision `2a66019a5ecf2b7a9f999ebfa04d04c9f548f19`: MIT; its notice is included in `vendor/atdd-flow/LICENSE`.

## Verification and limits

Run `npm run check` and `npm run smoke:release` for the release candidate. The release smoke uses a locally tagged copy and isolated Pi settings; it does not publish a tag. The Pi 1.5.2 pin-bump changelog notice limitation remains open; see the [0.4.0 release notes](RELEASE-0.4.0.md).
