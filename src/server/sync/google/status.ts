import type Database from 'better-sqlite3'
import type { SyncStatus } from '../../../shared/api/contract'

/** Cached events remain usable when this threshold has elapsed since success. */
export const GOOGLE_SYNC_STALE_AFTER_MS = 15 * 60 * 1000

type CalendarRow = {
  id: string
  name: string
  last_sync_attempt_at: string | null
  last_synced_at: string | null
  sync_error: string | null
}

export interface GoogleSyncStatusServiceOptions {
  now?: () => Date
  staleAfterMs?: number
  publish?: (status: SyncStatus) => void
}

/**
 * Persisted sync-health state. Error strings are deliberately generic: remote
 * provider payloads and credentials must never cross this boundary.
 */
export function createGoogleSyncStatusService(sqlite: Database.Database, options: GoogleSyncStatusServiceOptions = {}) {
  const now = options.now ?? (() => new Date())
  const staleAfterMs = options.staleAfterMs ?? GOOGLE_SYNC_STALE_AFTER_MS
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
    // pull.ts writes the cache timestamp atomically with its sync token. This
    // write also supports a scheduler that records a no-op successful pull.
    sqlite.prepare('UPDATE calendars SET last_synced_at = ?, sync_error = NULL WHERE id = ?').run(timestamp, calendarId)
    upsertService({ lastSucceededAt: timestamp, lastError: null })
    publish()
  }

  function fail(calendarId: string): void {
    active.delete(calendarId)
    const safeError = 'Google calendar sync failed. Cached events are still available.'
    sqlite.prepare('UPDATE calendars SET sync_error = ? WHERE id = ?').run(safeError, calendarId)
    upsertService({ lastError: safeError })
    publish()
  }

  function get(): SyncStatus {
    const calendars = sqlite.prepare<[], CalendarRow>(`
      SELECT id, name, last_sync_attempt_at, last_synced_at, sync_error
      FROM calendars WHERE selected = 1 AND deleted_at IS NULL ORDER BY name, id
    `).all().map((row) => ({
      id: row.id, name: row.name, lastAttemptAt: row.last_sync_attempt_at,
      lastSucceededAt: row.last_synced_at, error: row.sync_error
    }))
    const attempts = calendars.map((calendar) => calendar.lastAttemptAt).filter((value): value is string => value !== null)
    const successes = calendars.map((calendar) => calendar.lastSucceededAt).filter((value): value is string => value !== null)
    const lastAttemptAt = attempts.sort().at(-1) ?? null
    const lastSucceededAt = successes.sort().at(-1) ?? null
    const staleAfter = lastSucceededAt === null ? null : new Date(Date.parse(lastSucceededAt) + staleAfterMs).toISOString()
    const state: SyncStatus['state'] = active.size > 0 ? 'syncing'
      : calendars.some((calendar) => calendar.error !== null) ? 'failed'
      : calendars.some((calendar) => calendar.lastSucceededAt === null) ? 'never_synced'
      : calendars.some((calendar) => Date.parse(calendar.lastSucceededAt!) + staleAfterMs <= now().getTime()) ? 'stale'
      : 'fresh'
    return { state, lastSyncedAt: lastSucceededAt, lastAttemptAt, lastSucceededAt, staleAfter, calendars }
  }

  function publish(): void { options.publish?.(get()) }

  function upsertService(change: { lastStartedAt?: string; lastSucceededAt?: string; lastError?: string | null }): void {
    const previous = sqlite.prepare<[], { last_started_at: string | null; last_succeeded_at: string | null; last_error: string | null }>(
      "SELECT last_started_at, last_succeeded_at, last_error FROM sync_status WHERE service = 'google'"
    ).get()
    const timestamp = now().toISOString()
    sqlite.prepare(`INSERT INTO sync_status (service, last_started_at, last_succeeded_at, last_error, updated_at)
      VALUES ('google', ?, ?, ?, ?)
      ON CONFLICT(service) DO UPDATE SET last_started_at = excluded.last_started_at,
        last_succeeded_at = excluded.last_succeeded_at, last_error = excluded.last_error, updated_at = excluded.updated_at`)
      .run(change.lastStartedAt ?? previous?.last_started_at ?? null, change.lastSucceededAt ?? previous?.last_succeeded_at ?? null,
        change.lastError === undefined ? previous?.last_error ?? null : change.lastError, timestamp)
  }

  return { start, succeed, fail, get, publish, staleAfterMs }
}

export type GoogleSyncStatusService = ReturnType<typeof createGoogleSyncStatusService>
