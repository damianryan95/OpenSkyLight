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

## Deliverable

Let a parent create, edit and delete calendar events directly on a wall
display, with the change reaching the underlying calendar rather than living
only in the local cache.

- **Route each event to the right calendar.** `calendars.audience_person_id`
  already maps a calendar to a household member, so an event created for a
  person goes to that person's linked calendar. Define and implement the rule
  for the two gaps: a person with no linked writable calendar, and a Family
  event with no mapped person. Neither may silently write to an arbitrary
  calendar.
- **Respect read-only sources.** ICS feeds cannot be written, and CalDAV
  collections report their own privileges (`N14` already captures `readOnly`).
  A calendar that cannot accept a write must not be offered as a destination.
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

- A parent unlocks a display with the household PIN, creates an event, and it
  appears in the linked person's own calendar app.
- Editing and deleting an existing event propagate the same way.
- A locked display cannot create, edit, or delete anything; the editing window
  expires without leaving a writable surface behind.
- A read-only calendar is never offered as a destination, and a person with no
  writable calendar produces a clear explanation rather than a failed write.
- Editing a single occurrence leaves the rest of the series intact.
- Everything K03 still covers — chores beyond today, lists, meals, rewards,
  household settings — remains refused from a display, with its tests updated
  to assert the narrowed boundary rather than deleted.

Verify: browser journey for create/edit/delete on a display, PIN lock/expiry
tests, per-source read-only rejection tests, recurrence single-occurrence
tests, and a revised `K03` regression suite proving the remaining read-only
guarantees still hold.
