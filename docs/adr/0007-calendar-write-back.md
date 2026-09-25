# ADR 0007: Write-back routing, conflict resolution and the board's own calendar

**Status:** Accepted (direction set by the project owner, 2026-09-24)
**Date:** 2026-09-24
**Decision owner:** project owner
**Builds on:** [ADR 0002](0002-provider-agnostic-calendar-access.md)
**Implements the design note required by:** [`delivery-plan.md`](../delivery-plan.md) Milestone 3
**Governs:** [`N06`](../tickets/N06-bidirectional-calendar-sync-adr.md),
[`N15`](../tickets/N15-on-screen-calendar-editing.md)

## Context

Calendar sync is read-only in every direction. `N06` adds the write path and
`N15` puts an editor on the wall display. Both tickets defer three questions to
a design note rather than letting whichever write happens last decide them:

- where an event authored in OpenSkyLight actually lives;
- what happens when the same event is edited on the board and at its source
  between two syncs;
- what happens when a parent changes the person tagged in an event afterwards.

`N06` also requires that writes queued while a source is unreachable are applied
exactly once, and that nothing is duplicated as a result.

## Decision 1 — the board's own calendar, and one UID per event

**OpenSkyLight is itself a calendar.** A `local` source kind is added, exactly
one such source and calendar are seeded at first boot, and they are never
synced, never fetched, and never removed by a source removal.

An event authored on the board **always gets a row on that local calendar**, and
we generate its iCalendar UID. Tagging a person who has a linked writable
calendar enqueues an outward write **carrying that same UID**.

The consequence is the point of the design: when the next sync brings the remote
copy back, the UID deduplication already in `preferredMasters`
(`src/server/domain/eventFeeds.ts`) collapses the two copies and the wall shows
one. No second mechanism is needed to prevent the duplicate, and the local row
remains a complete record of the event even if the outward write never succeeds.

So local is the default and outward sync is the special case, as `N15` requires.
A household that connects no calendar at all still has a fully usable shared
family calendar.

### Why the modification time of a local row goes in `remote_updated_at`

That column means "when this copy was last modified", not "when a remote server
told us something". Writing the board's own edit time there lets
`preferredMasters` compare a local copy against a remote one without
special-casing either, and keeps the dedup rule in one place. Its existing
tie-break prefers the non-`phone` copy, so a `local` row wins an exact tie —
which is the outcome we want while an outward write is still in flight.

## Decision 2 — last-writer-wins, and the loser is recorded

**The most recently modified copy wins**, comparing modification times, with the
source-side copy breaking an exact tie. This is deliberately the same rule the
cross-source deduplication already applies, for the same reason given there: an
event is edited wherever the household keeps it, so freshness is a property of
the event and not of the source.

`N06` permits last-writer-wins **only** if it never silently discards a remote
edit. So the losing version is written to an `event_conflicts` record — which
side lost, its full payload, and when — and surfaced in sync health and in the
companion. A parent can therefore always see that something was overwritten and
what it said. A discarded edit that nobody can recover is not acceptable; a
discarded edit with a record is.

This rule is weaker than it looks on Android, which exposes no last-modified
date for calendar events at all. Those events fall back to the tie-break on
every comparison. That is a platform limitation, not a choice, and it is the
reason the conflict record exists rather than being optional.

## Decision 3 — re-tagging moves an event the board authored, and only that

Changing the tagged person on an event **OpenSkyLight created** moves it: it is
deleted from the previously targeted calendar and created in the newly targeted
one. The event lives where the tag says it lives.

Changing the tagged person on an event that arrived **from a real calendar**
changes who it is shown for on the board and nothing else. We do not delete an
event out of somebody's calendar that we did not put there. The `events.origin`
column exists to make that distinction, and without it the rule would not be
expressible.

The asymmetry is deliberate: the destructive half of "move it" is only safe on
an event we authored.

## Decision 4 — one outbound queue, coalescing, exactly once

Outward writes go through a single `event_writes` queue rather than being
attempted inline, so an unreachable source behaves identically whether the edit
originated on a phone or on the wall — which `N15` requires explicitly.

- Queue rows are **unique per calendar and UID**, so a parent who edits an event
  four times before the source comes back produces one write carrying the final
  state, not four.
- An acknowledged create records the `sourceEventId` the source assigned, so a
  replay after a crash becomes an update rather than a second create. This is
  what makes replay exactly-once rather than at-least-once.
- The queue is ordered and per-source, following the `last_pushed_at` ordering
  guard already used for phone pushes.

### Direction of travel differs by source, the queue does not

- **CalDAV** — the server writes directly, with `If-Match` against the stored
  etag for optimistic concurrency.
- **Phone** — the server cannot address a phone; the phone talks to us. So the
  phone **drains** the queue on the same cadence as its existing push, applies
  each operation through the OS calendar API, and acknowledges it. The queue is
  the same queue.
- **ICS** — no writer exists and none is possible. A feed is read-only by
  nature, is already marked `readOnly`, and refuses with that reason shown.

A person whose only linked calendar is read-only is therefore treated exactly
like a person with no linked calendar: the event stays local, silently and
correctly. This is the normal outcome and never an error.

## Consequences

- The kiosk stops being wholly read-only. `K03` is narrowed a second time, for
  calendar events only, behind the household PIN unlock that already gates
  display layout editing. Chores beyond today, lists, meals, rewards and
  household settings stay refused, and their tests are updated to assert the
  narrower boundary rather than deleted.
- A household with no calendar connected gains a working family calendar, which
  it did not have before.
- Remote error bodies still never reach logs, messages or the UI. The write path
  inherits that rule; a failed write reports a deliberately written message and
  the queue row carries the rest.
- An event that stays local forever is a success, not a pending failure, and
  nothing in the UI may present it as one.
