# N20 - On-screen chores, rewards and lists editing

Status: in progress (built and driven on the real server; awaiting use on the
wall)
Depends on: N15 (the PIN-bounded editing window and the header lock)
Narrows: K03, for the third time

## Context

Read `docs/tickets/K03-readonly-display.md` first. `N15` narrowed the read-only
display for calendar events behind the household PIN. This ticket, at the
owner's direction (2026-09-26), narrows it again for the two things a family
actually stands at a wall to do: cross things off a list and set up chores.

The kiosk already carried the upstream editors for both — `ListsView` hides
add/tick/delete behind `readOnly = isDisplayClient()`, and `SettingsSheet`
holds a complete chores-and-rewards editor a display never opened. The server
refused every channel they call. So this ticket is mostly: decide the rules,
whitelist the channels under them, unhide the editors, and re-assert the
boundary.

## Decisions (owner, 2026-09-26)

- **Lists are fully open on the wall — items and structure, no PIN.** A
  shopping list nobody standing at it can add to is not a shopping list. The
  cost is stated plainly and was accepted: a child can rename or delete a list.
- **Chores and rewards administration is behind the PIN**, in the same
  ten-minute unlock window `N15` uses and the same header padlock opens:
  create, edit and archive chores and rewards, and grant a pending reward
  request. The existing editor opens whole rather than being split.
- **Redeeming a reward from the wall stays refused.** It was refused before
  this ticket and was not asked for; the "★ Rewards" sheet a display already
  shows therefore still cannot spend stars. Recorded as a gap, not decided here.

## Deliverable

- Display RPC channels `lists:create/update/delete` and
  `listItems:add/toggle/delete/clearChecked`, **ungated**, delegating to the
  lists domain's `parentCommands` with the same validation the parent routes use.
- Display RPC channels `chores:create/update/delete`, `rewards:create/update/
  delete/grant`, gated by `requireDisplayEditWindow`; `rewards:redemptions` as
  a read. The kiosk editor speaks the legacy `RecurrenceInput` model, so the
  boundary translates it to the RRULE the chores service stores.
- **A latent data-loss trap fixed on the way.** The display read
  `chores:list` reported every chore's `recurrence` as `null`. Harmless while
  nothing on a display could write; with an editor, a weekly chore would have
  opened as "once" and saved back with its schedule wiped. It now parses
  `schedule_rrule`, and an update that says nothing about the schedule leaves
  it alone.
- Kiosk: `ListsView` open for all; `ChoresView` gains a **Manage** button;
  `SettingsSheet` on a display shows only the chores-and-rewards editor and no
  longer re-locks the window on close, because the header padlock is the
  explicit control there.

## Acceptance

- Anyone at a locked wall can create a list, add and tick items, clear checked
  items, rename and delete a list.
- A locked display is refused every chore and reward administration channel;
  once unlocked with the PIN, a parent creates a weekly chore from the wall and
  its schedule survives a later rename.
- Redeeming a reward, editing people, calendars, meals and household settings
  remain refused from a display in both lock states.
- `K03`'s tests assert the narrowed boundary rather than being deleted.

## Built (2026-09-26)

Driven on the real server and kiosk bundle: locked, a list is created and an
item added and ticked from the wall; chore creation is refused; the header
padlock and PIN open the window; **Manage** opens an editor that is only chores
and rewards; a weekly chore is created and reads back weekly; redeeming a reward
is still refused. Unit tests cover every channel in both lock states and the
schedule round-trip.

Not proven: a household member using it on the actual wall for a week. The
"child deletes the shopping list" cost is real and was chosen; if it bites,
gating list *structure* (create/rename/delete) behind the PIN while leaving
items open is a one-line change in the RPC whitelist and was the recommended
option.
