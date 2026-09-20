import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CachedIcalEvent } from './ical'

/** The forward and backward window the board actually renders. */
export const SYNC_WINDOW_PAST_DAYS = 30
export const SYNC_WINDOW_FUTURE_DAYS = 400

export function syncWindow(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 86_400_000),
    end: new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 86_400_000)
  }
}

/**
 * Commits one calendar's fetched events in a single transaction. The caller
 * stages the complete set first, so a failed or partial fetch never mutates a
 * cache the board is still rendering from.
 *
 * Every sync is a full snapshot of the window, so anything absent from it is
 * cancelled rather than left to linger on the wall.
 */
export function commitCalendarEvents(
  sqlite: Database.Database,
  calendarId: string,
  events: readonly CachedIcalEvent[],
  timestamp: string
): { changed: boolean } {
  let changed = false
  sqlite.transaction(() => {
    const seen = new Set<string>()
    const persist = (event: CachedIcalEvent): void => {
      seen.add(event.sourceEventId)
      const existing = sqlite.prepare<[string, string], { id: string; etag: string | null; status: string }>(
        'SELECT id, etag, status FROM events WHERE calendar_id = ? AND source_event_id = ?'
      ).get(calendarId, event.sourceEventId)
      if (existing && existing.etag !== null && existing.etag === event.etag && existing.status === event.status) return
      const values = [event.etag, event.icalUid, event.title, event.description, event.location, event.startAt, event.endAt,
        event.timezone, event.allDay ? 1 : 0, event.recurrence, event.recurrenceExdates, event.recurrenceRdates,
        event.recurringEventId, event.originalStartAt, event.status, event.remoteUpdatedAt, timestamp]
      if (existing) {
        sqlite.prepare(`UPDATE events SET etag=?, ical_uid=?, title=?, description=?, location=?, start_at=?, end_at=?, timezone=?, all_day=?,
          recurrence=?, recurrence_exdates=?, recurrence_rdates=?, recurring_event_id=?, original_start_at=?, status=?, remote_updated_at=?, updated_at=? WHERE id=?`)
          .run(...values, existing.id)
      } else {
        sqlite.prepare(`INSERT INTO events (id, calendar_id, source_event_id, etag, ical_uid, title, description, location, start_at, end_at, timezone,
          all_day, recurrence, recurrence_exdates, recurrence_rdates, recurring_event_id, original_start_at, status, remote_updated_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), calendarId, event.sourceEventId, ...values, timestamp)
      }
      changed = true
    }

    // A recurring master must exist before the exceptions that reference it.
    for (const event of events.filter((event) => event.recurringEventId === null)) persist(event)
    for (const event of events.filter((event) => event.recurringEventId !== null)) persist(event)

    const absent = sqlite.prepare<[string], { id: string; source_event_id: string }>(
      "SELECT id, source_event_id FROM events WHERE calendar_id = ? AND status != 'cancelled'"
    ).all(calendarId).filter((event) => !seen.has(event.source_event_id))
    for (const event of absent) {
      sqlite.prepare("UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?").run(timestamp, event.id)
      changed = true
    }

    sqlite.prepare('UPDATE calendars SET last_synced_at = ?, sync_error = NULL WHERE id = ?').run(timestamp, calendarId)
  })()
  return { changed }
}
