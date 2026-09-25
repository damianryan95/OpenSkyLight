import type Database from 'better-sqlite3'
import type { AckEventWritesRequest, PendingEventWriteDto } from '../../shared/api/contract'
import { eventSourceKey, parseEventSourceKey } from '../../shared/eventFeeds'
import { DomainValidationError } from '../domain/errors'
import type { EventWriteService } from '../domain/eventWrites'

/**
 * The phone half of write-back (ADR 0007).
 *
 * Every other source is written *to*; a phone cannot be. The server has no
 * address for it, so the direction is inverted: the phone asks what is
 * outstanding, applies each change through its own OS calendar API, and reports
 * back. The queue is the same queue the CalDAV drainer uses, so an edit behaves
 * identically regardless of where it is bound.
 */

export function createPhoneWriteService(sqlite: Database.Database, writes: EventWriteService) {
  function requirePhoneSource(sourceId: string): void {
    const row = sqlite.prepare<[string], { kind: string }>(
      'SELECT kind FROM calendar_sources WHERE id = ? AND deleted_at IS NULL'
    ).get(sourceId)
    if (row === undefined) throw new DomainValidationError('Calendar source not found.')
    if (row.kind !== 'phone') throw new DomainValidationError('Only a phone source drains the write queue.')
  }

  /**
   * What this phone still has to apply.
   *
   * `sourceEventId` is resolved from the mirror the last acknowledgement
   * recorded, which is what lets an update address the phone's own row instead
   * of searching for it. Its absence is how the phone knows to insert rather
   * than modify, so the two must agree — and they do because they are the same
   * record.
   */
  function pending(sourceId: string): PendingEventWriteDto[] {
    requirePhoneSource(sourceId)
    const calendarKeyPrefix = new Map(
      sqlite.prepare<[string], { id: string; source_calendar_id: string }>(
        'SELECT id, source_calendar_id FROM calendars WHERE source_id = ? AND deleted_at IS NULL'
      ).all(sourceId).map((row) => [row.id, row.source_calendar_id])
    )

    const result: PendingEventWriteDto[] = []
    for (const write of writes.pendingForSource(sourceId)) {
      const sourceCalendarId = calendarKeyPrefix.get(write.calendarId)
      if (sourceCalendarId === undefined) continue
      // A queued delete has no event row left, so the identity it needs comes
      // from the queue row's own record of the last acknowledgement.
      const mirror = write.eventId === null ? null
        : sqlite.prepare<[string], { mirror_key: string | null }>('SELECT mirror_key FROM events WHERE id = ?')
          .get(write.eventId)?.mirror_key ?? null
      const parsed = mirror === null ? null : parseEventSourceKey(mirror)
      // A mirror recorded against a different calendar names an event on that
      // other calendar, and must not be offered to this one as its own.
      const mirroredId = parsed !== null && parsed.calendarId === write.calendarId ? parsed.sourceEventId : null

      result.push({
        id: write.id,
        sourceCalendarId,
        operation: write.operation,
        icalUid: write.icalUid,
        sourceEventId: write.sourceEventId ?? mirroredId,
        event: {
          title: write.payload.title,
          description: write.payload.description,
          location: write.payload.location,
          startAt: write.payload.startAt,
          endAt: write.payload.endAt,
          timezone: write.payload.timezone,
          allDay: write.payload.allDay,
          recurrence: write.payload.recurrence,
          recurrenceExdates: write.payload.recurrenceExdates === null ? null : [...write.payload.recurrenceExdates],
          originalStartAt: write.payload.originalStartAt
        }
      })
    }
    return result
  }

  /**
   * Records what the phone managed to do.
   *
   * An applied create reports the id the operating system assigned. Storing it
   * as the event's mirror is load-bearing twice over: the next push carries that
   * same id, so the read side recognises the copy instead of showing the event a
   * second time, and a later edit can address the phone's row directly.
   */
  function acknowledge(sourceId: string, input: AckEventWritesRequest): { applied: number; failed: number } {
    requirePhoneSource(sourceId)
    const outstanding = new Map(writes.pendingForSource(sourceId).map((write) => [write.id, write]))
    let applied = 0
    let failed = 0

    sqlite.transaction(() => {
      for (const result of input.results) {
        // A phone may only acknowledge its own outstanding work. Without this a
        // paired phone could mark another source's writes done and silently
        // strand them.
        const write = outstanding.get(result.id)
        if (write === undefined) continue

        if (result.status === 'applied') {
          const assignedId = result.sourceEventId ?? null
          if (assignedId !== null && write.operation !== 'delete') {
            sqlite.prepare('UPDATE events SET mirror_key = ? WHERE id = ?')
              .run(eventSourceKey(write.calendarId, assignedId), write.eventId)
          }
          if (write.operation === 'delete') {
            sqlite.prepare('UPDATE events SET mirror_key = NULL WHERE id = ?').run(write.eventId)
          }
          writes.markSent(result.id, { sourceEventId: assignedId })
          applied += 1
        } else {
          // The phone's own words, bounded by the contract. Nothing here comes
          // from a remote server, so there is no credential to echo.
          writes.markFailed(result.id, result.message ?? 'The phone could not save this change to its calendar.')
          failed += 1
        }
      }
    })()

    return { applied, failed }
  }

  return { pending, acknowledge }
}

export type PhoneWriteService = ReturnType<typeof createPhoneWriteService>
