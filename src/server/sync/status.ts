import type Database from 'better-sqlite3'
import type { SyncStatus } from '../../shared/api/contract'

/** Cached events remain usable when this threshold has elapsed since success. */
export const CALENDAR_SYNC_STALE_AFTER_MS = 15 * 60 * 1000

const SYNC_SERVICE_KEY = 'calendar'

type CalendarRow = {
  id: string
  name: string
  last_sync_attempt_at: string | null
  last_synced_at: string | null
  sync_error: string | null
}

export interface CalendarSyncStatusServiceOptions {
  now?: () => Date
  staleAfterMs?: number
  publish?: (status: SyncStatus) => void
}

/**
 * Persisted sync-health state, keyed per calendar rather than per provider.
 * Error strings are deliberately generic: remote provider payloads and
 * credentials must never cross this boundary.
 */
export function createCalendarSyncStatusService(sqlite: Database.Database, options: CalendarSyncStatusServiceOptions = {}) {
  const now = options.now ?? (() => new Date())
  const staleAfterMs = options.staleAfterMs ?? CALENDAR_SYNC_STALE_AFTER_MS
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) throw new Error('staleAfterMs must be a positive integer.')
  const active = new Set<string>()

  function start(calendarId: string): void {
    const timestamp = now().toISOString()
    active.add(calendarId)
    sqlite.prepare('UPDATE calendars SET last_sync_attempt_at = ? WHERE id = ?').run(timestamp, calendarId)
    upsertService({ lastStartedAt: timestamp })
    publish()
  }

  function succeed(calendarId: string): void {
    active.delete(calendarId)
    const timestamp = now().toISOString()
    sqlite.prepare('UPDATE calendars SET last_synced_at = ?, sync_error = NULL WHERE id = ?').run(timestamp, calendarId)
    upsertService({ lastSucceededAt: timestamp, lastError: null })
    publish()
  }

  function fail(calendarId: string): void {
    active.delete(calendarId)
    const safeError = 'Calendar sync failed. Cached events are still available.'
    sqlite.prepare('UPDATE calendars SET sync_error = ? WHERE id = ?').run(safeError, calendarId)
    upsertService({ lastError: safeError })
    publish()
  }

  function get(): SyncStatus {
    // The board's own calendar is deliberately absent from sync health. It is
    // never fetched, so it would report `never_synced` for ever and hold the
    // whole household's state there while every real calendar was fine.
    const calendars = sqlite.prepare<[], CalendarRow>(`
      SELECT c.id, c.name, c.last_sync_attempt_at, c.last_synced_at, c.sync_error
      FROM calendars c JOIN calendar_sources s ON s.id = c.source_id
      WHERE c.selected = 1 AND c.deleted_at IS NULL AND s.deleted_at IS NULL AND s.kind != 'local'
      ORDER BY c.name, c.id
    `).all().map((row) => ({
      id: row.id, name: row.name, lastAttemptAt: row.last_sync_attempt_at,
      lastSucceededAt: row.last_synced_at, error: row.sync_error
    }))
    const attempts = calendars.map((calendar) => calendar.lastAttemptAt).filter((value): value is string => value !== null)
    const successes = calendars.map((calendar) => calendar.lastSucceededAt).filter((value): value is string => value !== null)
    const lastAttemptAt = attempts.sort().at(-1) ?? null
    const lastSucceededAt = successes.sort().at(-1) ?? null
    const staleAfter = lastSucceededAt === null ? null : new Date(Date.parse(lastSucceededAt) + staleAfterMs).toISOString()
    // A household that has not connected any calendar is not failing; it is
    // simply not set up yet, and the kiosk must say so rather than alarm.
    const state: SyncStatus['state'] = !hasSource() ? 'not_configured'
      : active.size > 0 ? 'syncing'
      : calendars.some((calendar) => calendar.error !== null) ? 'failed'
      : calendars.some((calendar) => calendar.lastSucceededAt === null) ? 'never_synced'
      : calendars.some((calendar) => Date.parse(calendar.lastSucceededAt!) + staleAfterMs <= now().getTime()) ? 'stale'
      : 'fresh'
    return { state, lastSyncedAt: lastSucceededAt, lastAttemptAt, lastSucceededAt, staleAfter, calendars, writeBack: writeBack() }
  }

  /**
   * The outward direction, counted rather than derived from the sync state.
   *
   * Deliberately not folded into `state`: a queued write is the normal condition
   * between an edit and the next tick, and treating it as ill health would make
   * the board cry wolf every time a parent touched an event.
   */
  function writeBack(): SyncStatus['writeBack'] {
    const counts = sqlite.prepare<[], { pending: number; failed: number }>(`
      SELECT
        COALESCE(SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0) AS failed
      FROM event_writes
    `).get()
    const conflicts = sqlite.prepare<[], { count: number }>(
      'SELECT COUNT(*) AS count FROM event_conflicts WHERE resolved_at IS NULL'
    ).get()
    return { pending: counts?.pending ?? 0, failed: counts?.failed ?? 0, conflicts: conflicts?.count ?? 0 }
  }

  /** Whether the household has connected anything. The seeded local calendar is
   * not a connection, so "no calendar connected" still means exactly that. */
  function hasSource(): boolean {
    return sqlite.prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM calendar_sources WHERE deleted_at IS NULL AND kind != 'local'"
    ).get()!.count > 0
  }

  function publish(): void { options.publish?.(get()) }

  function upsertService(change: { lastStartedAt?: string; lastSucceededAt?: string; lastError?: string | null }): void {
    const previous = sqlite.prepare<[string], { last_started_at: string | null; last_succeeded_at: string | null; last_error: string | null }>(
      'SELECT last_started_at, last_succeeded_at, last_error FROM sync_status WHERE service = ?'
    ).get(SYNC_SERVICE_KEY)
    const timestamp = now().toISOString()
    sqlite.prepare(`INSERT INTO sync_status (service, last_started_at, last_succeeded_at, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(service) DO UPDATE SET last_started_at = excluded.last_started_at,
        last_succeeded_at = excluded.last_succeeded_at, last_error = excluded.last_error, updated_at = excluded.updated_at`)
      .run(SYNC_SERVICE_KEY, change.lastStartedAt ?? previous?.last_started_at ?? null, change.lastSucceededAt ?? previous?.last_succeeded_at ?? null,
        change.lastError === undefined ? previous?.last_error ?? null : change.lastError, timestamp)
  }

  return { start, succeed, fail, get, publish, staleAfterMs }
}

export type CalendarSyncStatusService = ReturnType<typeof createCalendarSyncStatusService>
