# N15 - On-screen calendar editing

Status: planned
Depends on: N06

## Context

Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md)
and `docs/tickets/N06-bidirectional-calendar-sync-adr.md` — write-back has to
exist before anything can be written from a wall display.

Read `docs/tickets/K03-readonly-display.md` carefully. **This ticket narrows
K03 deliberately**, and is the second ticket to do so after `N06`. K03 is not
being abandoned: chores, lists, meals, rewards and household settings stay
read-only from a display. Only calendar events become writable, and only under
the conditions below.

Upstream `lowerygt/OpenSkyLight` at `v0.8.0` had exactly this feature before
the headless re-platforming removed it, and it is worth reading rather than
reinventing:

- `src/renderer/src/features/calendar/EventEditor.tsx` — the touch event editor,
  including the recurrence controls (daily/weekly/monthly/yearly, weekday
  picker, end date).
- `src/main/services/eventService.ts` — `create`, `update`, and the recurrence
  and exception handling behind them.

The on-screen keyboard those relied on (`src/renderer/src/components/Osk.tsx`)
still exists in this fork.

## OpenSkyLight is itself a calendar

This is the premise the rest of the ticket rests on, and it is a change of
model rather than a detail. The board is not only a cache of other people's
calendars — it is a calendar in its own right, and an event may live there and
nowhere else.

The routing rule follows from that, and it has no gaps:

- An event created on the board belongs to the **OpenSkyLight calendar** by
  default.
- It syncs outward **only** when a person is tagged in it **and** that person
  has a linked writable calendar. Then it is written to that person's calendar.
- A tagged person with **no** linked calendar: the event simply stays on the
  OpenSkyLight calendar. This is the normal outcome, not a failure, and must
  not surface as an error or a warning.
- A Family event with **no** tagged person: likewise stays on the OpenSkyLight
  calendar.

So local is the default and syncing outward is the special case — not the
reverse. A household that never connects any calendar still has a fully usable
shared family calendar, which is the behaviour the product's non-technical
target operator should get for free.

**Schema gap this exposes.** There is currently no way to represent the board's
own calendar: `calendar_sources.kind` permits only `caldav`, `ics` and `phone`.
The client type already anticipates it — `CalendarProvider` in
`src/shared/types/index.ts` still carries `'local'`, inherited from upstream,
where local calendars existed. A `local` source kind is therefore a
prerequisite of this ticket, and the OpenSkyLight calendar should exist from
first boot so the board always has somewhere to put an event.

## Deliverable

Let a parent create, edit and delete calendar events directly on a wall
display, following the routing rule above.

- **Add the built-in OpenSkyLight calendar.** Extend the source kinds with
  `local`, seed exactly one such calendar on first boot, and make it the
  default destination for anything created on the board. It is never synced,
  never fetched, and never deleted by a source removal.
- **Implement the outward rule.** Tagging a person whose calendar is writable
  writes the event there; everything else stays local. Changing an event's
  tagged person after the fact needs a defined outcome — decide it explicitly
  rather than leaving it to whichever write happens last.
- **Respect read-only sources.** ICS feeds cannot be written, and CalDAV
  collections report their own privileges (`N14` already captures `readOnly`).
  A person whose only linked calendar is read-only is treated exactly like a
  person with none: the event stays local, silently and correctly.
- **Gate it behind the household PIN.** A display sits on a wall where any
  child can reach it. Editing events is a parent action. The existing
  `displayLayoutEditUntil` unlock — `auth:verifyPin` grants a bounded editing
  window — is the precedent to follow rather than a new mechanism.
- **Reuse the write path from `N06`**, including its conflict rules and its
  offline queue. An edit made while the source is unreachable must behave the
  same whether it originated on the phone or the wall.
- **Recurrence**: editing one occurrence of a series must not silently rewrite
  the series. Follow the this-occurrence / whole-series distinction the
  expansion code already models via `RECURRENCE-ID` exceptions.

Likely files: `src/renderer/src/features/calendar/*` (a restored editor),
kiosk RPC routes in `src/server/api/router.ts`, the write path from `N06`,
`src/shared/api/contract.ts`, component and browser tests.

## Acceptance

- A parent unlocks a display with the household PIN, creates an event tagged
  with a person who has a linked writable calendar, and it appears in that
  person's own calendar app.
- An event with no tagged person, or tagged with a person who has no writable
  calendar, stays on the OpenSkyLight calendar, shows on the board, and
  produces no error or warning anywhere.
- A household with no calendar connected at all can still create, edit and
  delete events on the board and see them persist across a restart.
- Editing and deleting an existing synced event propagate the same way.
- A locked display cannot create, edit, or delete anything; the editing window
  expires without leaving a writable surface behind.
- Editing a single occurrence leaves the rest of the series intact.
- Everything K03 still covers — chores beyond today, lists, meals, rewards,
  household settings — remains refused from a display, with its tests updated
  to assert the narrowed boundary rather than deleted.

Verify: browser journey for create/edit/delete on a display, PIN lock/expiry
tests, per-source read-only rejection tests, recurrence single-occurrence
tests, and a revised `K03` regression suite proving the remaining read-only
guarantees still hold.
