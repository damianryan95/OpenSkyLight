import type Database from 'better-sqlite3'
import type { GooglePullSynchronizer } from './pull'

export const GOOGLE_SYNC_INTERVAL_MS = 60_000
export const GOOGLE_INITIAL_SYNC_DELAY_MS = 3_000

type Trigger = 'startup' | 'scheduled' | 'manual' | 'selection'
type Logger = Pick<Console, 'info' | 'warn'>

export interface GoogleSyncSchedulerOptions {
  sqlite: Database.Database
  getSynchronizer: () => GooglePullSynchronizer | undefined
  onEventsChanged: () => void
  logger?: Logger
  intervalMs?: number
  initialDelayMs?: number
}

/** Serializes selected-calendar pulls and keeps scheduling separate from OAuth. */
export function createGoogleSyncScheduler(options: GoogleSyncSchedulerOptions) {
  const logger = options.logger ?? console
  const intervalMs = options.intervalMs ?? GOOGLE_SYNC_INTERVAL_MS
  const initialDelayMs = options.initialDelayMs ?? GOOGLE_INITIAL_SYNC_DELAY_MS
  let interval: NodeJS.Timeout | undefined
  let initial: NodeJS.Timeout | undefined
  let running = false

  async function run(trigger: Trigger): Promise<void> {
    if (running) {
      log('info', { event: 'google.sync.skipped', trigger, reason: 'already_running' })
      return
    }
    const synchronizer = options.getSynchronizer()
    if (!synchronizer) return
    const calendars = options.sqlite.prepare<[], { id: string; name: string }>(`
      SELECT id, name FROM calendars WHERE selected = 1 AND deleted_at IS NULL ORDER BY name, id
    `).all()
    if (calendars.length === 0) return

    running = true
    let changed = false
    let failed = 0
    log('info', { event: 'google.sync.started', trigger, calendarCount: calendars.length })
    try {
      for (const calendar of calendars) {
        try {
          const result = await synchronizer.pullCalendar(calendar.id)
          changed ||= result.changed
          log('info', { event: 'google.sync.calendar_succeeded', calendarId: calendar.id, calendarName: calendar.name, changed: result.changed, full: result.full })
        } catch {
          failed += 1
          // Do not include third-party error text: it can echo a request URL or credential.
          log('warn', { event: 'google.sync.calendar_failed', calendarId: calendar.id, calendarName: calendar.name, error: 'Google calendar sync failed. Cached events are still available.' })
        }
      }
      if (changed) options.onEventsChanged()
      log(failed === 0 ? 'info' : 'warn', { event: 'google.sync.completed', trigger, calendarCount: calendars.length, changed, failed })
    } finally {
      running = false
    }
  }

  function start(): void {
    if (interval !== undefined) return
    initial = setTimeout(() => { void run('startup') }, initialDelayMs)
    initial.unref()
    interval = setInterval(() => { void run('scheduled') }, intervalMs)
    interval.unref()
  }
  function stop(): void {
    if (initial !== undefined) clearTimeout(initial)
    if (interval !== undefined) clearInterval(interval)
    initial = undefined
    interval = undefined
  }
  function syncNow(trigger: 'manual' | 'selection' = 'manual'): Promise<void> { return run(trigger) }
  function isRunning(): boolean { return running }
  function log(level: 'info' | 'warn', data: Record<string, unknown>): void { logger[level](JSON.stringify(data)) }

  return { start, stop, syncNow, isRunning }
}

export type GoogleSyncScheduler = ReturnType<typeof createGoogleSyncScheduler>
