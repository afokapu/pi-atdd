# pi-atdd 0.5.0 (ATD-45)

This release includes the plan at `plan/pi-atdd`, generated activation selectors, vocabulary v4 with v3 aliases, profile-aware roots and the real-Pi delivery gate. The reviewer checklist covers draft migration claims. The `src/` and `tests/` layout moves remain unfinished; this release does not claim migration parity.

## Licences

The preceding release's [licence review](RELEASE-0.4.0.md#licences) records the pinned upstream revisions and evidence:

- `vendor/atdd-bun`, revision `5945d97e18310e7c862c08e73985400935d21346`: no upstream licence found at that revision; the owner approved shipping the vendored content.
- `vendor/atdd-flow`, revision `2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a`: MIT; its notice is included in `vendor/atdd-flow/LICENSE`.

## Verification and limits

Run `npm run check` and `npm run smoke:release` for the release candidate. The release smoke uses a locally tagged copy and isolated Pi settings; it does not publish a tag. The previously documented Pi 1.5.2 pin-bump changelog notice limitation remains open; see [0.4.0 release notes](RELEASE-0.4.0.md).
