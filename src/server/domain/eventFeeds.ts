import type Database from 'better-sqlite3'
import { deriveEffectivePersonIds, type AudiencePerson } from '../../shared/audience'
import type { EventFeedOccurrence, EventFeedWindow } from '../../shared/eventFeeds'
import { expandOccurrences, type ExceptionLike, type MasterEventLike } from '../../shared/recurrence/expand'

export type { EventFeedOccurrence, EventFeedWindow } from '../../shared/eventFeeds'

interface EventRow {
  id: string
  calendar_id: string
  source_event_id: string
  ical_uid: string | null
  source_kind: 'caldav' | 'ics' | 'phone'
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string
  timezone: string
  all_day: number
  recurrence: string | null
  recurrence_exdates: string | null
  recurrence_rdates: string | null
  recurring_event_id: string | null
  original_start_at: string | null
  status: 'confirmed' | 'cancelled'
  audience_person_id: string | null
}

function parsedDates(value: string | null): string[] | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null
  } catch {
    return null
  }
}

function asMaster(row: EventRow): MasterEventLike {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    tz: row.timezone,
    allDay: row.all_day === 1,
    rrule: row.recurrence,
    exdates: parsedDates(row.recurrence_exdates),
    rdates: parsedDates(row.recurrence_rdates)
  }
}

function asException(row: EventRow, masterId: string): ExceptionLike | null {
  if (row.original_start_at === null) return null
  return {
    id: row.id,
    recurringEventId: masterId,
    originalStartAt: row.original_start_at,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status
  }
}

/**
 * One household calendar reached through two sources — a phone that holds it
 * and a CalDAV account that serves it — caches the same event twice. iCalendar
 * UIDs are globally unique by specification, so the same non-null `ical_uid`
 * from two sources is the same event, and only one copy may reach the board.
 *
 * The server-side copy wins. It stays fresh when nobody opens the phone app,
 * which is precisely the property ADR 0002 kept a server-side source for, so it
 * is the more trustworthy of the two. Deduplication is deliberately done at
 * master granularity: an exception is attached to a master within its own
 * calendar, so dropping a master takes its exceptions with it and no series is
 * ever split across sources. A null `ical_uid` identifies nothing and is never
 * deduplicated against anything.
 */
function preferredMasters(masters: readonly EventRow[]): EventRow[] {
  const serverSideFirst = (row: EventRow): number => (row.source_kind === 'phone' ? 1 : 0)
  const winners = new Map<string, EventRow>()
  for (const master of masters) {
    if (master.ical_uid === null) continue
    const incumbent = winners.get(master.ical_uid)
    // Rows arrive ordered by start then id, so an equal-rank tie keeps the
    // first deterministically rather than depending on scan order.
    if (incumbent === undefined || serverSideFirst(master) < serverSideFirst(incumbent)) winners.set(master.ical_uid, master)
  }
  return masters.filter((master) => master.ical_uid === null || winners.get(master.ical_uid) === master)
}

function assertWindow(window: EventFeedWindow): void {
  const start = Date.parse(window.start)
  const end = Date.parse(window.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('Event feed window must contain valid ISO timestamps with end after start.')
  }
}

/**
 * Read-only event queries over the cached event store. Audience associations are
 * deliberately evaluated at read time, so a child rename immediately changes
 * name inference without touching cached events.
 */
export function createEventFeedService(sqlite: Database.Database) {
  const peopleStatement = sqlite.prepare<[], AudiencePerson>(`
    SELECT id, name, role FROM people WHERE deleted_at IS NULL ORDER BY sort_order, created_at
  `)
  const eventStatement = sqlite.prepare<[], EventRow>(`
    SELECT e.id, e.calendar_id, e.source_event_id, e.ical_uid, e.title, e.description, e.location,
           e.start_at, e.end_at, e.timezone, e.all_day, e.recurrence, e.recurrence_exdates,
           e.recurrence_rdates, e.recurring_event_id, e.original_start_at, e.status,
           c.audience_person_id, s.kind AS source_kind
    FROM events e
    JOIN calendars c ON c.id = e.calendar_id
    JOIN calendar_sources s ON s.id = c.source_id
    WHERE c.selected = 1 AND c.deleted_at IS NULL AND s.deleted_at IS NULL
    ORDER BY e.start_at, e.id
  `)

  function occurrences(window: EventFeedWindow): EventFeedOccurrence[] {
    assertWindow(window)
    const people = peopleStatement.all()
    const rows = eventStatement.all()
    const masters = preferredMasters(rows.filter((row) => row.recurring_event_id === null && row.status === 'confirmed'))
    const masterBySourceKey = new Map(masters.map((row) => [`${row.calendar_id}\u0000${row.source_event_id}`, row]))
    const exceptionsByMaster = new Map<string, EventRow[]>()
    for (const row of rows) {
      if (row.recurring_event_id === null) continue
      const master = masterBySourceKey.get(`${row.calendar_id}\u0000${row.recurring_event_id}`)
      if (master === undefined) continue // A partial cache cannot safely expand an orphaned exception.
      const exceptions = exceptionsByMaster.get(master.id) ?? []
      exceptions.push(row)
      exceptionsByMaster.set(master.id, exceptions)
    }

    const result: EventFeedOccurrence[] = []
    for (const master of masters) {
      const rowsById = new Map<string, EventRow>([[master.id, master]])
      const exceptions = (exceptionsByMaster.get(master.id) ?? [])
        .map((row) => {
          rowsById.set(row.id, row)
          return asException(row, master.id)
        })
        .filter((row): row is ExceptionLike => row !== null)
      let expanded
      try {
        expanded = expandOccurrences(asMaster(master), exceptions, window.start, window.end)
      } catch {
        // A malformed upstream event must not make the whole household feed
        // unavailable; the next sync can correct or remove it.
        continue
      }
      for (const occurrence of expanded) {
        const row = rowsById.get(occurrence.eventId)!
        const personIds = deriveEffectivePersonIds({
          mappedPersonId: master.audience_person_id,
          title: row.title,
          description: row.description,
          people
        })
        result.push({
          key: `${row.id}|${occurrence.occurrenceStart}`,
          eventId: row.id,
          masterId: master.id,
          calendarId: row.calendar_id,
          title: row.title,
          description: row.description,
          location: row.location,
          start: occurrence.start,
          end: occurrence.end,
          timezone: row.timezone,
          allDay: row.all_day === 1,
          isRecurring: master.recurrence !== null,
          occurrenceStart: occurrence.occurrenceStart,
          personIds
        })
      }
    }
    return result.sort((left, right) => left.start === right.start ? left.title.localeCompare(right.title) : left.start.localeCompare(right.start))
  }

  /** Family is an all-events view, including events with personal audiences. */
  function family(window: EventFeedWindow): EventFeedOccurrence[] {
    return occurrences(window)
  }

  /** A personal view includes only occurrences dynamically associated with that active person. */
  function personal(personId: string, window: EventFeedWindow): EventFeedOccurrence[] {
    if (!peopleStatement.all().some((person) => person.id === personId)) return []
    return occurrences(window).filter((occurrence) => occurrence.personIds.includes(personId))
  }

  return { occurrences, family, personal }
}

export type EventFeedService = ReturnType<typeof createEventFeedService>
