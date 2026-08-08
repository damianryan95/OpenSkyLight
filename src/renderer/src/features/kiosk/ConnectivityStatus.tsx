import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { SyncStatus } from '@shared/api/contract'
import { browserGetSyncStatus, type BrowserConnectionStatus } from '../../api/browser'
import { subscribePush } from '../../api/client'
import { isDisplayClient } from '../../lib/clientMode'

const INITIAL_STATUS: SyncStatus = { state: 'never_synced', lastSyncedAt: null, calendars: [] }

function describeLastSuccess(status: SyncStatus): string | null {
  const value = status.lastSucceededAt ?? status.lastSyncedAt
  if (value === null || value === undefined) return null
  const relative = DateTime.fromISO(value).toRelative({ locale: 'en' })
  return relative === null ? null : `Last synced ${relative}`
}

/** A deliberately quiet display-only indicator. It never gates cached content. */
export function ConnectivityStatus() {
  const [connection, setConnection] = useState<BrowserConnectionStatus>('connecting')
  const [sync, setSync] = useState<SyncStatus>(INITIAL_STATUS)

  useEffect(() => {
    if (!isDisplayClient()) return
    let active = true
    const refresh = (): void => {
      void browserGetSyncStatus().then((status) => { if (active) setSync(status) }).catch(() => undefined)
    }
    refresh()
    const offConnection = subscribePush('push:connectionStatus', (data) => {
      const state = (data as { state?: BrowserConnectionStatus }).state
      if (state === 'live' || state === 'reconnecting' || state === 'connecting') setConnection(state)
      if (state === 'live') refresh()
    })
    const offSync = subscribePush('push:syncStatus', (data) => {
      const parsed = (data === null || typeof data !== 'object') ? undefined : data
      if (parsed !== undefined) setSync(parsed as SyncStatus)
    })
    return () => { active = false; offConnection(); offSync() }
  }, [])

  if (!isDisplayClient()) return null
  let message: string | null = null
  if (connection !== 'live') message = connection === 'connecting' ? 'Connecting to server…' : 'Reconnecting to server…'
  else if (sync.state === 'never_synced') message = 'Google calendar has not synced yet'
  else if (sync.state === 'stale' || sync.state === 'failed' || sync.state === 'error') {
    message = describeLastSuccess(sync) === null ? 'Calendar data may be out of date' : `Calendar data may be out of date · ${describeLastSuccess(sync)}`
  }
  if (message === null) return null
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-3 left-1/2 z-[65] -translate-x-1/2 rounded-full bg-ink/80 px-4 py-1.5 text-sm font-bold text-paper shadow-card backdrop-blur-sm">
      {message}
    </div>
  )
}
