# N05 - Phone-native calendar connector

Status: planned
Depends on: N13

## Context

Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md)
section "Source A". This ticket was previously a blocked decision spike; the
decision is made and it is now an implementation ticket. Build on the
provider-agnostic seam `N13` leaves behind.

## Deliverable

The companion phone app reads the calendars the phone already holds, through
the operating system's own APIs (EventKit on iOS, CalendarProvider on
Android), and pushes occurrences to the server. The household grants one OS
permission prompt; there is no account to connect, no API key, and no
credential for the server to store.

- Let the parent choose which of the phone's calendars to share, and map each
  to Family or a household member using the existing mapping UI.
- Push occurrences for a bounded forward window on app open, on calendar
  change notification, and on whatever background refresh the platform grants.
- Make the push idempotent and ordered so repeated or out-of-order pushes
  cannot duplicate or resurrect deleted occurrences.
- Record a per-source last-seen timestamp feeding the sync-health surface, so
  the board can show that phone-sourced data is going stale.
- Reconcile deletions explicitly: an occurrence absent from a full-window push
  is removed, so a cancelled event does not linger on the wall.

Note the platform limitation honestly in the UI: background execution is
restricted on both mobile platforms, so freshness tracks phone usage. A
household that needs guaranteed freshness adds a CalDAV source (`N14`)
alongside this; both sources coexist under the same schema.

This requires a native or hybrid mobile capability that the current
browser-based companion app does not have. Establishing that delivery vehicle
is part of this ticket's scoping and may justify splitting it once the
approach is chosen. Report the split rather than silently expanding scope.

Likely files: companion app mobile layer (new), a push API route in
`src/server/api/router.ts`, `src/shared/api/contract.ts`,
`src/server/domain/eventFeeds.ts`, tests.

## Acceptance

- A parent grants calendar permission on the phone and sees those events on
  the kiosk without entering any URL, key, or password.
- Repeated pushes are idempotent; deleted and cancelled events disappear from
  the board.
- Phone-sourced and CalDAV-sourced events coexist without duplication when
  both point at the same underlying calendar.
- Stale phone-sourced data is visibly indicated rather than silently wrong.
- No calendar credential from the phone is ever transmitted to or stored on
  the server; only occurrence data is pushed.

Verify: idempotency and deletion-reconciliation tests, duplicate-source
tests against `N14`, staleness-indicator test, and a real-device check on
both mobile platforms.
