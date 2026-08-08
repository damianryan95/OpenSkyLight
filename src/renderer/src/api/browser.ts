import type { IpcChannel, IpcContract, IpcResult } from '@shared/ipc/contract'
import { apiContract, serverEventSchema, syncStatusEventSchema, type ServerEvent, type SyncStatus } from '@shared/api/contract'
import { isCelebrationForDisplay } from '@shared/celebration'

const DISPLAY_CREDENTIAL_KEY = 'osl.displayCredential'
const DISPLAY_ID_KEY = 'osl.displayId'
type PushListener = (data: unknown) => void
export type BrowserConnectionStatus = 'connecting' | 'live' | 'reconnecting'
const pushListeners = new Map<string, Set<PushListener>>()
let streamStarted = false

class BrowserIpcError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'IpcError'
  }
}

/** Adopt a one-time display bootstrap fragment, never sent to the server or retained in history. */
export function adoptDisplayBootstrap(): void {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const credential = params.get('displayCredential')
  const displayId = params.get('displayId')
  if (credential !== null) {
    localStorage.setItem(DISPLAY_CREDENTIAL_KEY, credential)
    if (displayId !== null) localStorage.setItem(DISPLAY_ID_KEY, displayId)
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
}

export function displayCredential(): string | null { return localStorage.getItem(DISPLAY_CREDENTIAL_KEY) }
export function displayId(): string | null { return localStorage.getItem(DISPLAY_ID_KEY) }

/** The browser kiosk reads the richer server sync-health document directly.
 * The legacy Electron IPC shape deliberately remains unchanged. */
export async function browserGetSyncStatus(fetchImpl: typeof fetch = fetch): Promise<SyncStatus> {
  const credential = displayCredential()
  const headers = new Headers({ Accept: 'application/json' })
  if (credential !== null) headers.set('Authorization', `Bearer ${credential}`)
  const response = await fetchImpl(apiContract.syncStatus.path, { headers, cache: 'no-store' })
  if (!response.ok) throw new BrowserIpcError('network_error', `Sync status failed (${response.status})`)
  return syncStatusEventSchema.parse(await response.json())
}

/** Browser equivalent of the legacy typed IPC bridge. The server owns /api/rpc authorization. */
export async function browserInvoke<K extends IpcChannel>(channel: K, req: IpcContract[K]['req']): Promise<IpcContract[K]['res']> {
  const headers = new Headers({ Accept: 'application/json' })
  const credential = displayCredential()
  if (credential !== null) headers.set('Authorization', `Bearer ${credential}`)
  if (req !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api/rpc/${encodeURIComponent(channel)}`, {
    method: 'POST', headers, body: req === undefined ? undefined : JSON.stringify(req)
  })
  const result = await response.json().catch(() => undefined) as IpcResult<IpcContract[K]['res']> | undefined
  if (!response.ok || result === undefined || !result.ok) {
    const error = result !== undefined && !result.ok ? result.error : { code: 'network_error', message: `Request failed (${response.status})` }
    throw new BrowserIpcError(error.code, error.message)
  }
  return result.data
}

export function browserSubscribe(channel: string, callback: PushListener): () => void {
  const listeners = pushListeners.get(channel) ?? new Set<PushListener>()
  listeners.add(callback)
  pushListeners.set(channel, listeners)
  startEventStream()
  return () => { listeners.delete(callback); if (listeners.size === 0) pushListeners.delete(channel) }
}

function emit(channel: string, data: unknown): void {
  for (const listener of pushListeners.get(channel) ?? []) {
    // A visual-only subscriber must never take down transport dispatch or the
    // data-invalidating subscribers that keep the kiosk current.
    try { listener(data) } catch (error) { console.warn(`Push subscriber failed for ${channel}`, error) }
  }
}

/** Fetch SSE instead of EventSource: device credentials remain in Authorization, not a URL. */
function startEventStream(): void {
  if (streamStarted || displayCredential() === null) return
  streamStarted = true
  let lastEventId: string | undefined
  let hasConnected = false
  const connect = async (): Promise<void> => {
    try {
      const headers = new Headers({ Accept: 'text/event-stream', Authorization: `Bearer ${displayCredential()!}` })
      if (lastEventId !== undefined) headers.set('Last-Event-ID', lastEventId)
      const response = await fetch('/api/v1/events', { headers })
      if (!response.ok || response.body === null) throw new Error('Event stream unavailable')
      emit('push:connectionStatus', { state: 'live' satisfies BrowserConnectionStatus, recovered: hasConnected })
      hasConnected = true
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        let end: number
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
          const event = parseSseFrame(frame)
          if (event !== undefined) { lastEventId = event.id; dispatchServerEvent(event) }
        }
      }
    } catch {
      // Keep rendering the query cache while transport retries in the background.
      emit('push:connectionStatus', { state: 'reconnecting' satisfies BrowserConnectionStatus })
    } finally { window.setTimeout(() => void connect(), 1_000) }
  }
  void connect()
}

function parseSseFrame(frame: string): ServerEvent | undefined {
  const lines = frame.split('\n')
  const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim()
  const type = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
  const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim()
  if (id === undefined || type === undefined || data === undefined) return undefined
  try {
    const parsed = serverEventSchema.safeParse({ id, type, data: JSON.parse(data) })
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function dispatchServerEvent(event: ServerEvent): void {
  if (event.type === 'query.invalidated') emit('push:dataChanged', { domain: event.data.resources[0] })
  if (event.type === 'sync.status') emit('push:syncStatus', event.data)
  if (event.type === 'stream.connected') emit('push:streamRevalidated', event.data)
  if (event.type === 'chore.changed') emit('push:dataChanged', { domain: 'chores' })
  if (event.type === 'celebration.requested' && isCelebrationForDisplay(event.data, displayId())) {
    emit('push:celebrationRequested', event.data)
  }
}
