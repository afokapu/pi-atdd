# pi-atdd 0.5.1 (ATD-48)

This release fixes automatic 85% handoff in jj-colocated repositories. Handoff records are stored outside the working copy, the directory chain is validated, and recovery checks both stores. CI runs a smoke test with pinned jj-cli. ATD-46, ATD-47 and PR #45 are not included.

## Licences

The [0.4.0 licence review](RELEASE-0.4.0.md#licences) records the pinned upstream revisions and evidence:

- `vendor/atdd-bun`, revision `5945d97e18310e7c862c08e73985400935d21346`: no upstream licence found at that revision; the owner approved shipping the vendored content.
- `vendor/atdd-flow`, revision `2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a`: MIT; its notice is included in `vendor/atdd-flow/LICENSE`.

## Verification and limits

Run `npm run check` and `npm run smoke:release` for the release candidate. The release smoke uses a locally tagged copy and isolated Pi settings; it does not publish a tag. The Pi 1.5.2 pin-bump changelog notice limitation remains open; see the [0.4.0 release notes](RELEASE-0.4.0.md).
