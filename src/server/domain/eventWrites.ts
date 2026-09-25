import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { WritableEvent } from '../sync/icalWrite'

/**
 * The outbound write queue and the conflict log (ADR 0007).
 *
 * Every outward change goes through here rather than being attempted inline, so
 * an unreachable calendar behaves identically whether the edit came from the
 * wall display or from a parent's phone — which is the property `N15` requires
 * and the reason this is a table and not a retry loop.
 */

export type WriteOperation = 'create' | 'update' | 'delete'

export interface QueuedEventWrite {
  id: string
  /** Null once the event has been deleted here — which is exactly the state a
   * queued delete is usually in, so nothing may depend on it being present. */
  eventId: string | null
  calendarId: string
  icalUid: string
  operation: WriteOperation
  payload: WritableEvent
  /** The version this write expects to replace, captured when it was queued. It
   * is the precondition for a delete, whose event row may be long gone. */
  etag: string | null
  /** What the source called the event, once a create has been acknowledged.
   * This is what turns a replayed create into an update. */
  sourceEventId: string | null
  attempts: number
  createdAt: string
}

export interface EventConflict {
  id: string
  eventId: string
  calendarId: string
  discardedSide: 'local' | 'remote'
  discardedPayload: unknown
  detectedAt: string
}

interface WriteRow {
  id: string
  event_id: string | null
  calendar_id: string
  ical_uid: string
  operation: WriteOperation
  payload: string
  etag: string | null
  source_event_id: string | null
  state: 'pending' | 'sent' | 'failed'
  attempts: number
  created_at: string
}

const WRITE_COLUMNS = 'id, event_id, calendar_id, ical_uid, operation, payload, etag, source_event_id, state, attempts, created_at'

/**
 * How many times a write is retried before it is parked as `failed`. A source
 * that has refused nine times is not going to accept the tenth on this tick, and
 * a row that retries forever hides a real problem behind a busy queue.
 */
export const MAX_WRITE_ATTEMPTS = 8

function toQueued(row: WriteRow): QueuedEventWrite {
  return {
    id: row.id,
    eventId: row.event_id,
    calendarId: row.calendar_id,
    icalUid: row.ical_uid,
    operation: row.operation,
    payload: JSON.parse(row.payload) as WritableEvent,
    etag: row.etag,
    sourceEventId: row.source_event_id,
    attempts: row.attempts,
    createdAt: row.created_at
  }
}

/**
 * Whether the source currently holds this event, judged from the queue row
 * alone. This is the question every coalescing decision turns on, and it is
 * answerable without a network call:
 *
 * - a row that has been **sent** left the source in the state its operation
 *   describes, so anything but a delete means the event is there;
 * - a row still **waiting** has not changed the source at all, so what it was
 *   queued to do tells us what was true beforehand — a queued create implies
 *   the source did not have it, a queued update or delete implies it did.
 */
function sourceHoldsEvent(row: WriteRow): boolean {
  if (row.state === 'sent') return row.operation !== 'delete'
  return row.operation !== 'create'
}

export function createEventWriteService(sqlite: Database.Database, options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date())

  const selectByTarget = sqlite.prepare<[string, string], WriteRow>(
    `SELECT ${WRITE_COLUMNS} FROM event_writes WHERE calendar_id = ? AND ical_uid = ?`
  )

  /**
   * Queues one outward change, coalescing it with anything already waiting for
   * the same event on the same calendar.
   *
   * Coalescing is not an optimisation here. A parent who corrects a title four
   * times while the calendar server is down must produce one write carrying the
   * final state — four sequential writes would each be a separate chance to
   * fail, and replaying a create twice is exactly the duplicate `N06` forbids.
   */
  function enqueue(input: {
    eventId: string
    calendarId: string
    icalUid: string
    operation: WriteOperation
    payload: WritableEvent
    /** The version being replaced, so a delete keeps its precondition after the
     * event row it came from has gone. */
    etag?: string | null
  }): void {
    const timestamp = now().toISOString()
    const existing = selectByTarget.get(input.calendarId, input.icalUid)

    if (existing === undefined) {
      sqlite.prepare(
        `INSERT INTO event_writes (id, event_id, calendar_id, ical_uid, operation, payload, etag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), input.eventId, input.calendarId, input.icalUid, input.operation, JSON.stringify(input.payload), input.etag ?? null, timestamp, timestamp)
      return
    }

    const holds = sourceHoldsEvent(existing)

    if (input.operation === 'delete' && !holds) {
      // The source never saw this event, so there is nothing out there to
      // delete. Dropping the row is the whole of the work.
      sqlite.prepare('DELETE FROM event_writes WHERE id = ?').run(existing.id)
      return
    }

    const operation: WriteOperation = input.operation === 'delete' ? 'delete' : holds ? 'update' : 'create'
    // A fresh edit earns a fresh set of attempts: the previous failure was
    // about the previous payload, and a parked row must not stay parked.
    sqlite.prepare(
      `UPDATE event_writes
       SET operation = ?, payload = ?, event_id = ?, etag = COALESCE(?, etag),
           state = 'pending', attempts = 0, last_error = NULL, updated_at = ?
       WHERE id = ?`
    ).run(operation, JSON.stringify(input.payload), input.eventId, input.etag ?? null, timestamp, existing.id)
  }

  /** Writes waiting for one calendar, oldest first. */
  function pendingForCalendar(calendarId: string): QueuedEventWrite[] {
    return sqlite.prepare<[string], WriteRow>(
      `SELECT ${WRITE_COLUMNS} FROM event_writes WHERE calendar_id = ? AND state = 'pending' ORDER BY created_at, id`
    ).all(calendarId).map(toQueued)
  }

  /** Writes waiting across every calendar belonging to one source. */
  function pendingForSource(sourceId: string): QueuedEventWrite[] {
    return sqlite.prepare<[string], WriteRow>(
      `SELECT ${WRITE_COLUMNS.split(', ').map((column) => `w.${column}`).join(', ')}
       FROM event_writes w
       JOIN calendars c ON c.id = w.calendar_id
       WHERE c.source_id = ? AND c.deleted_at IS NULL AND w.state = 'pending'
       ORDER BY w.created_at, w.id`
    ).all(sourceId).map(toQueued)
  }

  /**
   * Records that the source applied the write.
   *
   * `sourceEventId` is the load-bearing half. Keeping the row rather than
   * deleting it is deliberate: it is the only record of what the source decided
   * to call this event, and without it a replay after a crash would create a
   * second copy instead of updating the first.
   */
  function markSent(id: string, result: { sourceEventId?: string | null } = {}): void {
    const timestamp = now().toISOString()
    sqlite.prepare(
      `UPDATE event_writes
       SET state = 'sent', last_error = NULL, last_attempt_at = ?, updated_at = ?,
           source_event_id = COALESCE(?, source_event_id)
       WHERE id = ?`
    ).run(timestamp, timestamp, result.sourceEventId ?? null, id)
  }

  /** Records a failed attempt, parking the row once it has had enough of them. */
  function markFailed(id: string, message: string): void {
    const timestamp = now().toISOString()
    sqlite.prepare(
      `UPDATE event_writes
       SET attempts = attempts + 1,
           state = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
           last_error = ?, last_attempt_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(MAX_WRITE_ATTEMPTS, message, timestamp, timestamp, id)
  }

  /** Abandons a queued write outright — used when the conflict rule decides the
   * source's version wins, so ours must not be retried over the top of it. */
  function discard(id: string): void {
    sqlite.prepare('DELETE FROM event_writes WHERE id = ?').run(id)
  }

  /** Points a queued write at the version it should now expect to replace, after
   * a conflict revealed that the source had moved on. */
  function refreshEtag(id: string, etag: string | null): void {
    sqlite.prepare('UPDATE event_writes SET etag = ?, updated_at = ? WHERE id = ?').run(etag, now().toISOString(), id)
  }

  /**
   * Records the version that last-writer-wins threw away. ADR 0007 permits the
   * rule only because this exists: a parent can always see that something was
   * overwritten and what it said.
   */
  function recordConflict(input: {
    eventId: string | null
    calendarId: string
    discardedSide: 'local' | 'remote'
    discardedPayload: unknown
  }): void {
    sqlite.prepare(
      `INSERT INTO event_conflicts (id, event_id, calendar_id, discarded_side, discarded_payload, detected_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), input.eventId, input.calendarId, input.discardedSide, JSON.stringify(input.discardedPayload), now().toISOString())
  }

  function openConflicts(): EventConflict[] {
    return sqlite.prepare<[], {
      id: string; event_id: string; calendar_id: string; discarded_side: 'local' | 'remote'; discarded_payload: string; detected_at: string
    }>(
      `SELECT id, event_id, calendar_id, discarded_side, discarded_payload, detected_at
       FROM event_conflicts WHERE resolved_at IS NULL ORDER BY detected_at DESC, id`
    ).all().map((row) => ({
      id: row.id,
      eventId: row.event_id,
      calendarId: row.calendar_id,
      discardedSide: row.discarded_side,
      discardedPayload: JSON.parse(row.discarded_payload) as unknown,
      detectedAt: row.detected_at
    }))
  }

  function resolveConflict(id: string): void {
    sqlite.prepare('UPDATE event_conflicts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').run(now().toISOString(), id)
  }

  /** Writes parked after exhausting their attempts, for sync health to report. */
  function failedCount(): number {
    return (sqlite.prepare<[], { count: number }>("SELECT count(*) AS count FROM event_writes WHERE state = 'failed'").get()?.count) ?? 0
  }

  return {
    enqueue, pendingForCalendar, pendingForSource, markSent, markFailed, discard, refreshEtag,
    recordConflict, openConflicts, resolveConflict, failedCount
  }
}

export type EventWriteService = ReturnType<typeof createEventWriteService>
