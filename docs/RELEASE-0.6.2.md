# pi-atdd 0.6.2 (ATD-46)

Convention pages carry omitted rules across turns (delivered once per rule), post-tool continuation uses a bounded queue with an overflow notice, and non-blocking pages no longer promise an undeliverable retry.

ATD-49, ATD-51, ATD-52 and ATD-37 (PR #45) are not included.

## Licences

The [0.4.0 licence review](RELEASE-0.4.0.md#licences) records the pinned upstream revisions and evidence:

- `vendor/atdd-bun`, revision `5945d97e18310e7c862c08e73985400935d21346`: no upstream licence found at that revision; the owner approved shipping the vendored content.
- `vendor/atdd-flow`, revision `2a66019a5ecf2b7a9f999ebfa04d04c9f548f19`: MIT; its notice is included in `vendor/atdd-flow/LICENSE`.

## Verification and limits

Run `npm run check` and `npm run smoke:release` for the release candidate. The release smoke uses a locally tagged copy and isolated Pi settings; it does not publish a tag. The Pi 1.5.2 pin-bump changelog notice limitation remains open; see the [0.4.0 release notes](RELEASE-0.4.0.md).
