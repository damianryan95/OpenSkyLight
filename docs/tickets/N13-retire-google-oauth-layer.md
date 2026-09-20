# N13 - Retire the Google OAuth layer and de-Google the event schema

Status: ready
Depends on: (none — ADR 0002 is accepted)

## Context

Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md)
in full. Read `docs/adr/0001-headless-google-oauth.md` only for historical
context — it is superseded. Inspect `src/server/sync/google/` (~911 lines),
`src/shared/eventFeeds.ts`, `src/server/domain/eventFeeds.ts`, and
`src/server/db/migrations.ts`.

## Deliverable

Remove the Google-specific OAuth and sync layer, and make the event storage
and feed contracts provider-agnostic so `N14` (CalDAV/ICS) and `N05`
(phone-native) have a clean seam to build on.

- Delete `src/server/sync/google/` and its API routes, vault, scheduler, and
  status service. Remove the `@googleapis/calendar` and `google-auth-library`
  dependencies.
- **Amend the existing migrations in place rather than appending a reversal
  migration.** The Google schema is baked into migration 001 and extended by
  later ones; there is no production data and no install to preserve, so edit
  those migrations so the Google tables were never created. Do not add a
  seventh migration that drops what 001 builds — the schema should read as if
  Google never existed.
- In the amended schema, `events.google_event_id` becomes `source_event_id`
  with a `source` discriminator, and `calendars.google_account_id` /
  `google_calendar_id` become source-neutral equivalents. `google_accounts`,
  `google_configuration`, and `google_oauth_attempts` disappear entirely.
- Any existing database volume is discarded, not migrated. Note this plainly
  in the deployment docs.
- Correct the Google-specific wording and fields in `src/shared/eventFeeds.ts`
  and the API contracts in `src/shared/api/contract.ts`.
- Rework sync health (`G05`'s surface) around per-source liveness rather than
  a single Google pull outcome. A household with no source configured must
  report a clear "no calendar connected" state, not a permanent failure.
- Remove the Google connect/disconnect/vault-unlock UI from the companion app
  and the kiosk settings surface.

This ticket removes capability deliberately. The product has no calendar
source between this ticket and `N14`/`N05`; do not attempt to keep Google
working behind a flag.

Likely files: `src/server/sync/google/*` (deleted), `src/server/api/router.ts`,
`src/server/server.ts`, `src/server/db/migrations.ts`,
`src/server/domain/eventFeeds.ts`, `src/shared/eventFeeds.ts`,
`src/shared/api/contract.ts`, `src/companion/src/pages/PeopleCalendarsPage.tsx`,
`src/companion/src/pages/DisplaysDiagnosticsPage.tsx`,
`src/renderer/src/features/settings/SettingsSheet.tsx`, `package.json`, tests.

## Acceptance

- No Google-specific credential, scope, vault, table, column, or route remains
  in the codebase or the database schema.
- A fresh volume builds the complete schema cleanly from the amended
  migrations, with no Google artifacts at any point in the sequence.
- A fresh install reports "no calendar connected" and remains fully usable for
  chores, lists, meals, and personalization.
- The kiosk, display auth, and celebration paths are untouched by this change.
- `npm run typecheck`, `npm test`, and `npm run build` pass, and the Linux CI
  job (including the Docker build and Trivy scan) is green.

Verify: fresh-volume schema build, feed-expansion tests against the renamed
columns, fresh-install smoke test, typecheck, build.
