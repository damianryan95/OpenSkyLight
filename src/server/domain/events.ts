import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { LOCAL_CALENDAR_ID } from '../../shared/localCalendar'
import type { WritableEvent } from '../sync/icalWrite'
import { DomainValidationError } from './errors'
import type { EventWriteService, WriteOperation } from './eventWrites'

/**
 * Authoring calendar events (ADR 0007, `N06`/`N15`). The read side lives in
 * `eventFeeds.ts` and stays read-only; this is the only module that writes to
 * the `events` table on a household member's behalf.
 *
 * The rule it exists to enforce, in one sentence: **an event authored here lives
 * on the board's own calendar, and travels outward only when a tagged person has
 * somewhere writable to put it.** Staying local is the normal outcome and must
 * never be reported as a failure.
 */

export interface EventDraft {
  title: string
  description: string | null
  location: string | null
  /** UTC ISO instant. */
  startAt: string
  /** UTC ISO instant. */
  endAt: string
  timezone: string
  allDay: boolean
  /** RRULE body without the property name, or null for a one-off. */
  recurrence: string | null
  /** The person this event is for, or null for a family event. */
  personId: string | null
}

export interface AuthoredEvent {
  id: string
  calendarId: string
  /** Where the outward copy is headed, or null when the event stays local. */
  destinationCalendarId: string | null
  icalUid: string
}

interface EventRow {
  id: string
  calendar_id: string
  source_event_id: string
  ical_uid: string | null
  origin: 'local' | 'remote'
  audience_person_id: string | null
  mirror_key: string | null
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string
  timezone: string
  all_day: number
  recurrence: string | null
  recurrence_exdates: string | null
  recurring_event_id: string | null
  original_start_at: string | null
  status: 'confirmed' | 'cancelled'
  etag: string | null
}

const EVENT_COLUMNS = `id, calendar_id, source_event_id, ical_uid, origin, audience_person_id, mirror_key, title,
  description, location, start_at, end_at, timezone, all_day, recurrence, recurrence_exdates,
  recurring_event_id, original_start_at, status, etag`

function parsedDates(value: string | null): string[] | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null
  } catch {
    return null
  }
}

function assertDraft(draft: EventDraft): void {
  if (draft.title.trim().length === 0) throw new DomainValidationError('Give this event a title.')
  const start = Date.parse(draft.startAt)
  const end = Date.parse(draft.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new DomainValidationError('This event needs a valid start and end time.')
  if (end < start) throw new DomainValidationError('An event cannot end before it starts.')
}

export function createEventAuthoringService(
  sqlite: Database.Database,
  writes: EventWriteService,
  options: { now?: () => Date } = {}
) {
  const now = options.now ?? (() => new Date())

  function requireEvent(id: string): EventRow {
    const row = sqlite.prepare<[string], EventRow>(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(id)
    if (row === undefined) throw new DomainValidationError('That event no longer exists.')
    return row
  }

  /**
   * The calendar a tagged person's events should be written to, or null.
   *
   * Null is the ordinary answer, not an error: an untagged event, a person with
   * no linked calendar, and a person whose only calendar is a read-only feed all
   * land here and all mean "keep it local".
   *
   * When a person has more than one writable calendar the server-side one wins,
   * because it stays fresh when nobody opens the phone app — the same reasoning
   * the read-side deduplication uses for its tie-break.
   */
  function destinationFor(personId: string | null): string | null {
    if (personId === null) return null
    const row = sqlite.prepare<[string, string], { id: string }>(
      `SELECT c.id FROM calendars c
       JOIN calendar_sources s ON s.id = c.source_id
       WHERE c.audience_person_id = ?
         AND c.selected = 1 AND c.read_only = 0 AND c.deleted_at IS NULL
         AND s.deleted_at IS NULL AND s.kind != 'local'
         AND c.id != ?
       ORDER BY CASE s.kind WHEN 'caldav' THEN 0 ELSE 1 END, c.id
       LIMIT 1`
    ).get(personId, LOCAL_CALENDAR_ID)
    return row?.id ?? null
  }

  function asWritable(row: EventRow, icalUid: string): WritableEvent {
    return {
      icalUid,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      timezone: row.timezone,
      allDay: row.all_day === 1,
      recurrence: row.recurrence,
      recurrenceExdates: parsedDates(row.recurrence_exdates),
      recurringEventId: row.recurring_event_id,
      originalStartAt: row.original_start_at,
      status: row.status
    }
  }

  function enqueue(row: EventRow, calendarId: string, operation: WriteOperation): void {
    if (row.ical_uid === null) return
    writes.enqueue({
      eventId: row.id,
      calendarId,
      icalUid: row.ical_uid,
      operation,
      payload: asWritable(row, row.ical_uid),
      // Captured now, because a delete outlives the row it came from.
      etag: row.etag
    })
  }

  /**
   * Creates an event on the board's own calendar, and queues it outward when the
   * routing rule says it has somewhere to go.
   *
   * The same iCalendar UID is used for the local row and the outward write. That
   * is what lets the read side's UID deduplication collapse the copy that comes
   * back on the next sync, so one authored event shows once on the wall without
   * a second mechanism to suppress it.
   */
  function create(draft: EventDraft): AuthoredEvent {
    assertDraft(draft)
    if (draft.personId !== null) {
      const person = sqlite.prepare<[string], { id: string }>('SELECT id FROM people WHERE id = ? AND deleted_at IS NULL').get(draft.personId)
      if (person === undefined) throw new DomainValidationError('Choose a current household member.')
    }

    const id = randomUUID()
    // A UID we mint, rather than one a server assigns, so the outward write and
    // the local row are the same event from the first moment.
    const icalUid = `${id}@openskylight`
    const timestamp = now().toISOString()
    const destination = destinationFor(draft.personId)

    sqlite.transaction(() => {
      sqlite.prepare(
        `INSERT INTO events (id, calendar_id, source_event_id, ical_uid, origin, audience_person_id, title, description,
           location, start_at, end_at, timezone, all_day, recurrence, status, remote_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
      ).run(
        id, LOCAL_CALENDAR_ID, icalUid, icalUid, draft.personId, draft.title.trim(), draft.description,
        draft.location, draft.startAt, draft.endAt, draft.timezone, draft.allDay ? 1 : 0, draft.recurrence,
        // `remote_updated_at` means "when this copy was last modified", so the
        // conflict rule can compare a local row against a remote one without
        // special-casing either. ADR 0007 explains why this column and not a new one.
        timestamp, timestamp, timestamp
      )
      if (destination !== null) enqueue(requireEvent(id), destination, 'create')
    })()

    return { id, calendarId: LOCAL_CALENDAR_ID, destinationCalendarId: destination, icalUid }
  }

  /**
   * Edits an event, following the re-tag rule when the tagged person changes.
   *
   * Re-tagging **moves** an event the board authored: it is deleted from the
   * calendar it was going to and created on the new one. On an event that came
   * from a real calendar it changes only who the board shows it for — we do not
   * delete an event out of somebody's calendar that we did not put there.
   */
  function update(id: string, patch: Partial<EventDraft>): AuthoredEvent {
    const existing = requireEvent(id)
    const merged: EventDraft = {
      title: patch.title ?? existing.title,
      description: patch.description === undefined ? existing.description : patch.description,
      location: patch.location === undefined ? existing.location : patch.location,
      startAt: patch.startAt ?? existing.start_at,
      endAt: patch.endAt ?? existing.end_at,
      timezone: patch.timezone ?? existing.timezone,
      allDay: patch.allDay ?? existing.all_day === 1,
      recurrence: patch.recurrence === undefined ? existing.recurrence : patch.recurrence,
      personId: patch.personId === undefined ? existing.audience_person_id : patch.personId
    }
    assertDraft(merged)

    const previousDestination = destinationFor(existing.audience_person_id)
    const nextDestination = destinationFor(merged.personId)
    const timestamp = now().toISOString()

    sqlite.transaction(() => {
      sqlite.prepare(
        `UPDATE events SET title = ?, description = ?, location = ?, start_at = ?, end_at = ?, timezone = ?,
           all_day = ?, recurrence = ?, audience_person_id = ?, remote_updated_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        merged.title.trim(), merged.description, merged.location, merged.startAt, merged.endAt, merged.timezone,
        merged.allDay ? 1 : 0, merged.recurrence, merged.personId, timestamp, timestamp, id
      )
      const updated = requireEvent(id)

      if (existing.origin === 'local' && previousDestination !== nextDestination && previousDestination !== null) {
        // The destructive half of "move it", and the only place it happens.
        enqueue(existing, previousDestination, 'delete')
      }
      if (nextDestination !== null) {
        enqueue(updated, nextDestination, previousDestination === nextDestination ? 'update' : 'create')
      }
    })()

    return { id, calendarId: existing.calendar_id, destinationCalendarId: nextDestination, icalUid: existing.ical_uid ?? '' }
  }

  /**
   * Edits one occurrence of a series without touching the rest of it.
   *
   * The override is a separate row keyed by the occurrence it replaces, which is
   * the `RECURRENCE-ID` shape `shared/recurrence/expand.ts` already expands and
   * `mapIcalEvent` already parses. The master is left completely alone — that is
   * the guarantee `N15` asks for, and writing to the master instead is precisely
   * the bug it warns against.
   */
  function updateOccurrence(masterId: string, occurrenceStart: string, patch: Partial<EventDraft>): AuthoredEvent {
    const master = requireEvent(masterId)
    if (master.recurrence === null) throw new DomainValidationError('That event is not part of a series.')
    if (!Number.isFinite(Date.parse(occurrenceStart))) throw new DomainValidationError('That occurrence could not be identified.')

    const existing = sqlite.prepare<[string, string, string], EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE calendar_id = ? AND recurring_event_id = ? AND original_start_at = ?`
    ).get(master.calendar_id, master.source_event_id, occurrenceStart)

    if (existing !== undefined) return update(existing.id, patch)

    const id = randomUUID()
    const timestamp = now().toISOString()
    const merged: EventDraft = {
      title: patch.title ?? master.title,
      description: patch.description === undefined ? master.description : patch.description,
      location: patch.location === undefined ? master.location : patch.location,
      startAt: patch.startAt ?? occurrenceStart,
      // Without an explicit end, the override keeps the series' own duration.
      endAt: patch.endAt ?? new Date(Date.parse(occurrenceStart) + (Date.parse(master.end_at) - Date.parse(master.start_at))).toISOString(),
      timezone: patch.timezone ?? master.timezone,
      allDay: patch.allDay ?? master.all_day === 1,
      recurrence: null,
      personId: patch.personId === undefined ? master.audience_person_id : patch.personId
    }
    assertDraft(merged)
    const destination = destinationFor(merged.personId)

    sqlite.transaction(() => {
      sqlite.prepare(
        `INSERT INTO events (id, calendar_id, source_event_id, ical_uid, origin, audience_person_id, title, description,
           location, start_at, end_at, timezone, all_day, recurring_event_id, original_start_at, status,
           remote_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
      ).run(
        id, master.calendar_id,
        // The same identity `mapIcalEvent` builds for an override, so a series
        // edited here and a series read from CalDAV key their exceptions alike.
        `${master.source_event_id}::${occurrenceStart}`,
        master.ical_uid, master.origin, merged.personId, merged.title.trim(), merged.description, merged.location,
        merged.startAt, merged.endAt, merged.timezone, merged.allDay ? 1 : 0,
        master.source_event_id, occurrenceStart, timestamp, timestamp, timestamp
      )
      if (destination !== null) enqueue(requireEvent(id), destination, 'update')
    })()

    return { id, calendarId: master.calendar_id, destinationCalendarId: destination, icalUid: master.ical_uid ?? '' }
  }

  /**
   * Cancels a single occurrence by excluding it from the series, rather than by
   * deleting the master. Stored as an EXDATE the expansion already honours.
   */
  function removeOccurrence(masterId: string, occurrenceStart: string): void {
    const master = requireEvent(masterId)
    if (master.recurrence === null) throw new DomainValidationError('That event is not part of a series.')
    const exdates = parsedDates(master.recurrence_exdates) ?? []
    if (!exdates.includes(occurrenceStart)) exdates.push(occurrenceStart)
    const timestamp = now().toISOString()

    sqlite.transaction(() => {
      sqlite.prepare('UPDATE events SET recurrence_exdates = ?, remote_updated_at = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(exdates), timestamp, timestamp, masterId)
      // Any override for that occurrence is now unreachable and would be an
      // orphan the feed silently drops; remove it rather than leave it behind.
      sqlite.prepare('DELETE FROM events WHERE calendar_id = ? AND recurring_event_id = ? AND original_start_at = ?')
        .run(master.calendar_id, master.source_event_id, occurrenceStart)
      const destination = destinationFor(master.audience_person_id)
      if (destination !== null) enqueue(requireEvent(masterId), destination, 'update')
    })()
  }

  /** Deletes an event, and queues its removal from wherever it was sent. */
  function remove(id: string): void {
    const existing = requireEvent(id)
    const destination = destinationFor(existing.audience_person_id)
    sqlite.transaction(() => {
      if (destination !== null && existing.origin === 'local') enqueue(existing, destination, 'delete')
      // Overrides reference the master by source id rather than by foreign key,
      // so they do not cascade and have to go explicitly.
      sqlite.prepare('DELETE FROM events WHERE calendar_id = ? AND recurring_event_id = ?')
        .run(existing.calendar_id, existing.source_event_id)
      sqlite.prepare('DELETE FROM events WHERE id = ?').run(id)
    })()
  }

  return { create, update, updateOccurrence, removeOccurrence, remove, destinationFor }
}

export type EventAuthoringService = ReturnType<typeof createEventAuthoringService>
