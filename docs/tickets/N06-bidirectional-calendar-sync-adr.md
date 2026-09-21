# N06 - Bidirectional calendar sync

Status: planned
Depends on: N05, N14

## Context

Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md).
Read `docs/tickets/C03-remove-event-writes.md` for what the previous fork
removed and why, then note that ADR 0002 changes the premise: write-back no
longer requires a Google write scope, because writes go through the phone's
own calendar store or an authenticated CalDAV collection.

This ticket was previously a blocked decision spike. The direction is
decided; what remains is genuine engineering design, so expect to produce a
short design note before implementing.

## What "bidirectional" actually means here

OpenSkyLight is a calendar in its own right, not only a cache of other
people's. An event authored in OpenSkyLight lives on the OpenSkyLight calendar
and syncs outward **only** when a person is tagged in it and that person has a
linked writable calendar. An untagged event, or one tagged with a person who
has no writable calendar, stays local — permanently and correctly, not as a
failure state.

So this ticket is not "every local change is pushed everywhere". It is the
write path for the subset that has somewhere to go. `N15` states the routing
rule in full and owns the built-in local calendar that makes it possible.

## Deliverable

Let a parent add and edit events from OpenSkyLight, and have those changes
reach the underlying calendar where the routing rule says they should.

- Write-back through the phone-native connector (`N05`), using the OS calendar
  APIs, for phone-sourced calendars.
- Write-back through CalDAV (`N14`) for CalDAV-sourced collections. ICS feeds
  are read-only by nature and must be clearly marked as such in the UI.
- Define and implement conflict resolution when the same event is edited in
  two places between syncs. Last-writer-wins is acceptable only if it is
  explicit, documented, and never silently discards a remote edit without a
  record.
- Queue writes made while the source is unreachable and reconcile on
  reconnect, without duplicating events.
- Keep the kiosk read-only. Event creation and editing remain parent-phone
  actions; a wall display must not gain write capability.

Likely files: companion app editing UI, a write path in
`src/server/domain/eventFeeds.ts`, `src/server/sync/caldav/*`, the phone
connector from `N05`, `src/shared/api/contract.ts`, tests.

## Acceptance

- An event created on the phone in OpenSkyLight appears in the parent's own
  calendar app, and vice versa.
- An edit made while the source is unreachable is queued and applied on
  reconnect exactly once.
- Concurrent edits resolve by the documented rule, and a discarded edit is
  recorded rather than lost silently.
- Read-only sources (ICS) cannot be edited and say so in the UI.
- The kiosk gains no write capability; `K03`'s read-only guarantees still hold.

Verify: round-trip tests per source type, offline-queue and
exactly-once-replay tests, concurrent-edit conflict tests, and a regression
run of the `K03` read-only display tests.
