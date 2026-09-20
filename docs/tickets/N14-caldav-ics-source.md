# N14 - CalDAV and ICS calendar source

Status: planned
Depends on: N13

## Context

Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md)
section "Source B". Inspect the provider-agnostic seam `N13` leaves in
`src/shared/eventFeeds.ts` and `src/server/domain/eventFeeds.ts`. The
`ical.js` and `rrule` dependencies are already present and are the intended
parsing and recurrence tools.

## Deliverable

Let a parent connect any CalDAV collection or read-only ICS feed from the
phone, with no API key, cloud project, client secret, or domain ownership.

- CalDAV: base URL plus username and an app-specific password. Discover
  available collections, let the parent select which to show, and map each to
  Family or a household member using the existing calendar-mapping UI.
- ICS: a read-only feed URL, polled on the same schedule.
- Store credentials encrypted at rest using the existing application-key
  envelope pattern, not in plaintext.
- Poll on a bounded schedule with exponential backoff on failure, retaining
  the last good cache and feeding per-source liveness into the sync-health
  surface `N13` reworked.
- Expand recurrence with the existing shared expansion code so occurrences
  behave identically regardless of source.

Provider-agnostic by construction: iCloud, Google, Fastmail, Nextcloud, and
Zimbra all serve CalDAV. Do not add vendor-specific branches.

Likely files: new `src/server/sync/caldav/*`, `src/server/domain/eventFeeds.ts`,
`src/server/api/router.ts`, `src/shared/api/contract.ts`,
`src/companion/src/pages/PeopleCalendarsPage.tsx`, tests.

## Acceptance

- A parent connects a CalDAV account from a phone using only a URL, username,
  and app password, and selects which collections appear.
- An ICS URL can be added without any credential.
- Recurring events, exceptions, all-day events, and timezones match the
  behavior the Google path previously produced, verified against fixtures.
- A failing or unreachable source degrades to the last good cache with a
  visible stale indicator; it never blanks the board or crashes sync.
- Credentials never appear in logs, diagnostics, event payloads, or the event
  stream.
- Removing a source removes its cached events without affecting other sources.

Verify: fixture-based parsing/recurrence tests covering at least iCloud- and
Nextcloud-shaped CalDAV responses, failure/backoff tests, credential-redaction
tests, phone E2E for connect and disconnect.
