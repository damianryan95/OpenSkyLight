import type Database from 'better-sqlite3'
import { eventSourceKey } from '../../shared/eventFeeds'
import type { EventWriteService, QueuedEventWrite } from '../domain/eventWrites'
import { CalDavConflictError, CalDavError, type CalDavClient } from './caldav'
import { mapCalendarDocument } from './ical'
import { buildIcsDocument, resourceNameFor } from './icalWrite'

/**
 * Applies queued outward writes to CalDAV collections (ADR 0007).
 *
 * The phone half of write-back is not here and cannot be: the server has no way
 * to address a phone, so a phone drains the same queue over HTTP and applies the
 * operations itself. This module is only the sources the server can reach.
 */

export interface WriteBackResult {
  applied: number
  conflicted: number
  failed: number
}

/** Joins a collection URL to a resource name without losing a path segment. */
function resourceUrl(collectionUrl: string, icalUid: string): string {
  return `${collectionUrl.endsWith('/') ? collectionUrl : `${collectionUrl}/`}${resourceNameFor(icalUid)}`
}

interface CalendarTarget {
  id: string
  collectionUrl: string
}

export interface CalDavWriteBackOptions {
  now?: () => Date
  householdTimezone: () => string
  onEventsChanged?: () => void
}

/**
 * Drains the queue for one CalDAV source.
 *
 * Every branch below exists to keep one promise: a write is applied **exactly
 * once**, and a version that loses is recorded rather than lost. A row is only
 * ever marked sent after the server has confirmed it, and a row whose create
 * turns out to have already landed is confirmed rather than repeated.
 */
export function createCalDavWriteBack(
  sqlite: Database.Database,
  writes: EventWriteService,
  options: CalDavWriteBackOptions
) {
  const now = options.now ?? (() => new Date())

  function targetsForSource(sourceId: string): Map<string, CalendarTarget> {
    const rows = sqlite.prepare<[string], { id: string; source_calendar_id: string }>(
      `SELECT id, source_calendar_id FROM calendars
       WHERE source_id = ? AND selected = 1 AND read_only = 0 AND deleted_at IS NULL`
    ).all(sourceId)
    return new Map(rows.map((row) => [row.id, { id: row.id, collectionUrl: row.source_calendar_id }]))
  }

  /**
   * The version this write expects to replace. The live event row is preferred
   * because a pull since queueing may have refreshed it, but a queued delete
   * usually has no event row left at all — that is *why* it was queued — so it
   * falls back to the etag captured when the change was made.
   */
  function expectedEtagFor(write: QueuedEventWrite): string | null {
    if (write.eventId === null) return write.etag
    return sqlite.prepare<[string], { etag: string | null }>('SELECT etag FROM events WHERE id = ?').get(write.eventId)?.etag ?? write.etag
  }

  /**
   * Records that a local event now has an outward copy, so the read side can
   * suppress the duplicate when the next sync brings that copy back.
   *
   * The key is the identity the feed resolves rows by, and for CalDAV the source
   * event id is the UID — the same value `mapIcalEvent` reconstructs on the way
   * in, which is what makes the two halves agree.
   */
  function recordMirror(eventId: string | null, calendarId: string, sourceEventId: string, etag: string | null): void {
    // Nothing to record against: the local row has already gone, which only
    // happens on a delete, and a deleted event has no mirror to track.
    if (eventId === null) return
    sqlite.prepare('UPDATE events SET mirror_key = ?, etag = COALESCE(?, etag) WHERE id = ?')
      .run(eventSourceKey(calendarId, sourceEventId), etag, eventId)
  }

  /**
   * Decides a precondition failure by asking what the other version says.
   *
   * Last-writer-wins, with the loser recorded either way (ADR 0007). The
   * comparison is deliberately between modification times rather than between
   * sources: whoever touched the event most recently meant it.
   */
  async function resolveConflict(client: CalDavClient, write: QueuedEventWrite, target: CalendarTarget): Promise<'local' | 'remote'> {
    const url = resourceUrl(target.collectionUrl, write.icalUid)
    const current = await client.getEvent(url)
    if (current === null) {
      // The other writer deleted it. Our edit is the more recent intent, so it
      // is re-created rather than silently dropped.
      return 'local'
    }

    const remote = mapCalendarDocument(current.data, options.householdTimezone(), current.etag)
      .find((event) => event.recurringEventId === null) ?? mapCalendarDocument(current.data, options.householdTimezone(), current.etag)[0]
    const remoteModified = remote?.remoteUpdatedAt === undefined || remote.remoteUpdatedAt === null ? null : Date.parse(remote.remoteUpdatedAt)
    const localModified = write.eventId === null ? null
      : sqlite.prepare<[string], { remote_updated_at: string | null }>('SELECT remote_updated_at FROM events WHERE id = ?')
        .get(write.eventId)?.remote_updated_at
    const localAt = localModified == null ? null : Date.parse(localModified)

    // A remote with no modification time cannot out-date us; the board's edit is
    // the one we can actually place in time. This is the same tie-break the read
    // side applies, and the reason the conflict record is not optional.
    const remoteWins = remoteModified !== null && localAt !== null && remoteModified > localAt

    if (remoteWins) {
      writes.recordConflict({
        eventId: write.eventId, calendarId: target.id, discardedSide: 'local', discardedPayload: write.payload
      })
      // Let the next pull bring the winning version in, and stop trying to write
      // ours over the top of it.
      writes.discard(write.id)
      return 'remote'
    }

    writes.recordConflict({
      eventId: write.eventId, calendarId: target.id, discardedSide: 'remote', discardedPayload: remote ?? { note: 'unparseable remote version' }
    })
    // Retry against the version we just read, which is what the server will now
    // accept. Storing the etag is what makes that retry a replace, not a clash.
    // A deleted event has no row to store it on, so the queue row carries it.
    writes.refreshEtag(write.id, current.etag)
    if (write.eventId !== null) sqlite.prepare('UPDATE events SET etag = ? WHERE id = ?').run(current.etag, write.eventId)
    return 'local'
  }

  async function applyOne(client: CalDavClient, write: QueuedEventWrite, target: CalendarTarget): Promise<'applied' | 'conflicted' | 'failed'> {
    try {
      if (write.operation === 'delete') {
        await client.deleteEvent(resourceUrl(target.collectionUrl, write.icalUid), expectedEtagFor(write))
        writes.markSent(write.id, { sourceEventId: write.icalUid })
        return 'applied'
      }

      const body = buildIcsDocument(write.payload, now())
      // A create asserts the resource does not exist; an update asserts the
      // version it read. Both are preconditions, which is what stops a retry
      // duplicating and a concurrent edit vanishing.
      const expectedEtag = write.operation === 'create' ? null : expectedEtagFor(write)
      const result = await client.putEvent(resourceUrl(target.collectionUrl, write.icalUid), body, expectedEtag)
      recordMirror(write.eventId, target.id, write.icalUid, result.etag)
      writes.markSent(write.id, { sourceEventId: write.icalUid })
      return 'applied'
    } catch (error) {
      if (error instanceof CalDavConflictError) {
        const winner = await resolveConflict(client, write, target)
        if (winner === 'remote') return 'conflicted'
        // The board's version won, so try once more now that the etag is fresh.
        try {
          const body = buildIcsDocument(write.payload, now())
          if (write.operation === 'delete') {
            await client.deleteEvent(resourceUrl(target.collectionUrl, write.icalUid), expectedEtagFor(write))
          } else {
            const retry = await client.putEvent(resourceUrl(target.collectionUrl, write.icalUid), body, expectedEtagFor(write))
            recordMirror(write.eventId, target.id, write.icalUid, retry.etag)
          }
          writes.markSent(write.id, { sourceEventId: write.icalUid })
          return 'applied'
        } catch (retryError) {
          writes.markFailed(write.id, retryError instanceof CalDavError ? retryError.message : 'The change could not be saved to the calendar.')
          return 'failed'
        }
      }
      // A deliberately written message, never the remote body.
      writes.markFailed(write.id, error instanceof CalDavError ? error.message : 'The change could not be saved to the calendar.')
      return 'failed'
    }
  }

  async function drainSource(sourceId: string, client: CalDavClient): Promise<WriteBackResult> {
    const targets = targetsForSource(sourceId)
    const result: WriteBackResult = { applied: 0, conflicted: 0, failed: 0 }
    for (const write of writes.pendingForSource(sourceId)) {
      const target = targets.get(write.calendarId)
      // A calendar deselected between queueing and now has nowhere to write to.
      // Parking the row says so rather than retrying against a dead collection.
      if (target === undefined) {
        writes.markFailed(write.id, 'That calendar is no longer connected.')
        result.failed += 1
        continue
      }
      const outcome = await applyOne(client, write, target)
      result[outcome === 'applied' ? 'applied' : outcome === 'conflicted' ? 'conflicted' : 'failed'] += 1
    }
    if (result.applied > 0 || result.conflicted > 0) options.onEventsChanged?.()
    return result
  }

  return { drainSource }
}

export type CalDavWriteBack = ReturnType<typeof createCalDavWriteBack>
