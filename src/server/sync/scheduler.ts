import type { CalendarSourceService } from './sources'

export const SYNC_INTERVAL_MS = 15 * 60 * 1000
const MIN_BACKOFF_MS = 60 * 1000
const MAX_BACKOFF_MS = 60 * 60 * 1000

export interface SchedulerOptions {
  intervalMs?: number
  setTimer?: (handler: () => void, delayMs: number) => NodeJS.Timeout
  clearTimer?: (timer: NodeJS.Timeout) => void
}

/**
 * Polls every connected source on a bounded schedule. A failing run backs off
 * exponentially rather than hammering an unreachable server, and recovers to
 * the normal interval on the next success.
 */
export function createSyncScheduler(sources: CalendarSourceService, options: SchedulerOptions = {}) {
  const intervalMs = options.intervalMs ?? SYNC_INTERVAL_MS
  const setTimer = options.setTimer ?? ((handler, delayMs) => setTimeout(handler, delayMs))
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  let timer: NodeJS.Timeout | undefined
  let running = false
  let failures = 0
  let inFlight: Promise<void> | undefined

  function delay(): number {
    if (failures === 0) return intervalMs
    return Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (failures - 1))
  }

  function schedule(): void {
    if (!running) return
    timer = setTimer(() => { void run('scheduled') }, delay())
    // A long poll timer must never hold the process open by itself.
    timer.unref?.()
  }

  async function run(reason: 'scheduled' | 'manual'): Promise<void> {
    if (inFlight !== undefined) return inFlight
    inFlight = (async () => {
      try {
        await sources.syncAll()
        failures = 0
      } catch {
        failures += 1
      } finally {
        inFlight = undefined
        if (reason === 'scheduled') schedule()
      }
    })()
    return inFlight
  }

  return {
    start(): void {
      if (running) return
      running = true
      schedule()
    },
    stop(): void {
      running = false
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
    },
    syncNow(): Promise<void> { return run('manual') },
    isRunning(): boolean { return running }
  }
}

export type SyncScheduler = ReturnType<typeof createSyncScheduler>
