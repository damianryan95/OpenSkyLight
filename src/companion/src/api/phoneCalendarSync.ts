import type { CalendarSourceDto, PushPhoneCalendarsResponse } from '@shared/api/contract'
import { ApiError, isNativeApp, parentGet, parentRequest } from './client'
import {
  buildPushRequest,
  calendarDisplayName,
  canSplitRange,
  correctedPushOffset,
  limitCalendars,
  oversizeReason,
  phoneSyncWindow,
  splitRange,
  type DeviceCalendar,
  type TimeRange
} from './phoneCalendarMapping'
import { devicePhoneCalendarReader, requestCalendarPermission, type CalendarPermission, type PhoneCalendarReader } from './phoneCalendars'
import { drainPhoneWriteQueue } from './phoneWriteQueue'
import {
  clearPhoneSourceId,
  getClockOffsetMs,
  getLastPushedAt,
  getPairedDeviceName,
  getPhoneSourceId,
  setClockOffsetMs,
  setLastPushedAt,
  setPhoneSourceId
} from './phoneCalendarStorage'

/**
 * Pushing this phone's calendars to the household, as a service rather than a
 * screen. The push outlives whichever page the parent is looking at — it is
 * triggered by opening the app, not by navigating to the calendar section — so
 * the state lives here and the UI subscribes to it.
 *
 * Two values in a push can silently destroy a household's events, and both are
 * handled deliberately rather than incidentally:
 *
 * - `sourceEventId` must be identical for the same occurrence on every push, or
 *   each push replaces every row it just wrote. See `sourceEventIdFor`.
 * - `window` must describe exactly the slice that was read. The server cancels
 *   anything absent from the snapshot *inside that window*, so a chunk claiming
 *   a wider window than it read deletes real events. Every slice therefore
 *   carries its own bounds, and every calendar appears in every chunk.
 */

export type PhoneSyncPhase = 'idle' | 'syncing'

export interface PhoneSyncCalendarState {
  sourceCalendarId: string
  name: string
  /** What the server says: is this calendar actually reaching the board? */
  shared: boolean
  events: number
}

export interface PhoneSyncState {
  supported: boolean
  permission: CalendarPermission | 'unknown'
  phase: PhoneSyncPhase
  lastPushedAt: string | null
  lastError: string | null
  /** Slices whose events could not be sent at all, rather than were sent wrong.
   * Nothing is deleted for them; they simply stay as they were. */
  skippedSlices: number
  omittedCalendars: number
  calendars: PhoneSyncCalendarState[]
}

const AUTOMATIC_PUSH_INTERVAL_MS = 5 * 60_000
const MAX_SPLIT_DEPTH = 10

let state: PhoneSyncState = {
  supported: isNativeApp(),
  permission: 'unknown',
  phase: 'idle',
  lastPushedAt: null,
  lastError: null,
  skippedSlices: 0,
  omittedCalendars: 0,
  calendars: []
}

const listeners = new Set<() => void>()
let running: Promise<void> | null = null
let controller: AbortController | null = null
let lastAutomaticPushAt = 0

function publish(patch: Partial<PhoneSyncState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeToPhoneSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPhoneSyncState(): PhoneSyncState {
  return state
}

/** Hydrates the parts of the state that survive an app restart, so the panel
 * can say when the household last heard from this phone without pushing first. */
export function initialisePhoneSyncState(): void {
  publish({ supported: isNativeApp(), lastPushedAt: getLastPushedAt() })
}

class SliceTooLargeError extends Error {}
class ClockBehindServerError extends Error {
  constructor(readonly serverTimestamps: string[]) {
    super('The household server has already applied a newer snapshot from this phone.')
  }
}

/**
 * The household's phone source, created once and remembered.
 *
 * Adoption is by stored id only. Matching on anything softer — a name, or
 * "the only phone source" — would let a second phone in the household push into
 * the first one's source, where the two would fight over the ordering guard and
 * reconcile each other's events away. A duplicate source is visible and
 * removable; that is the safer way to be wrong.
 */
async function ensureSource(signal: AbortSignal): Promise<string> {
  const stored = getPhoneSourceId()
  const { sources } = await parentGet<{ sources: CalendarSourceDto[] }>('/api/v1/calendar-sources')
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (stored !== null && sources.some((source) => source.id === stored && source.kind === 'phone')) return stored
  const name = getPairedDeviceName() ?? 'This phone'
  const created = await parentRequest<CalendarSourceDto>('/api/v1/calendar-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'phone', name }),
    signal
  }, true)
  setPhoneSourceId(created.id)
  return created.id
}

async function postPush(sourceId: string, body: string, signal: AbortSignal): Promise<PushPhoneCalendarsResponse> {
  return parentRequest<PushPhoneCalendarsResponse>(`/api/v1/calendar-sources/${encodeURIComponent(sourceId)}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal
  }, true)
}

interface PushOutcome {
  /** Identities rather than a running total: a chunked window sends an event
   * that straddles a boundary in both halves, and a parent counting the events
   * on their own wall would not recognise a number that double-counted them. */
  calendars: Map<string, { name: string; shared: boolean; identities: Set<string> }>
  skipped: number
}

/**
 * Pushes one slice, halving it until it fits.
 *
 * Splitting is safe only because every half carries its own window and its own
 * complete set of calendars: the server reconciles inside the half it is given
 * and says nothing about the rest of the year. The size is measured before
 * sending, and a 413 is still handled, because the body is re-encoded by the
 * native HTTP bridge and only the server can be sure what arrived.
 */
async function pushSlice(
  sourceId: string,
  slice: TimeRange,
  pushedAt: string,
  calendars: readonly DeviceCalendar[],
  reader: PhoneCalendarReader,
  signal: AbortSignal,
  depth: number,
  outcome: PushOutcome
): Promise<void> {
  const events = await reader.listEvents(slice)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const request = buildPushRequest(pushedAt, slice, calendars, events, reader.timezone())

  const splittable = canSplitRange(slice) && depth < MAX_SPLIT_DEPTH
  if (oversizeReason(request) !== null) {
    if (!splittable) throw new SliceTooLargeError('This phone holds more events in a single day than one push can carry.')
    const [first, second] = splitRange(slice)
    await pushSlice(sourceId, first, pushedAt, calendars, reader, signal, depth + 1, outcome)
    await pushSlice(sourceId, second, pushedAt, calendars, reader, signal, depth + 1, outcome)
    return
  }

  let response: PushPhoneCalendarsResponse
  try {
    response = await postPush(sourceId, JSON.stringify(request), signal)
  } catch (reason) {
    if (reason instanceof ApiError && reason.status === 413 && splittable) {
      const [first, second] = splitRange(slice)
      await pushSlice(sourceId, first, pushedAt, calendars, reader, signal, depth + 1, outcome)
      await pushSlice(sourceId, second, pushedAt, calendars, reader, signal, depth + 1, outcome)
      return
    }
    if (reason instanceof ApiError && reason.status === 409) {
      throw new ClockBehindServerError(staleTimestampsOf(reason))
    }
    throw reason
  }

  for (const calendar of response.calendars) {
    const announced = request.calendars.find((entry) => entry.sourceCalendarId === calendar.sourceCalendarId)
    const existing = outcome.calendars.get(calendar.sourceCalendarId)
      ?? { name: announced?.name ?? calendar.sourceCalendarId, shared: calendar.selected, identities: new Set<string>() }
    existing.shared = calendar.selected
    // A cancelled occurrence is pushed so the board drops it, but counting it
    // would promise a parent more on the wall than they will find there.
    if (calendar.selected) {
      for (const entry of announced?.events ?? []) if (entry.status === 'confirmed') existing.identities.add(entry.sourceEventId)
    }
    outcome.calendars.set(calendar.sourceCalendarId, existing)
  }
}

function staleTimestampsOf(error: ApiError): string[] {
  const details = error.details as { stale?: { lastPushedAt?: unknown }[] } | undefined
  if (details === undefined || !Array.isArray(details.stale)) return []
  return details.stale.map((entry) => entry.lastPushedAt).filter((value): value is string => typeof value === 'string')
}

export interface PhoneSyncOptions {
  /** A manual tap or a selection change pushes immediately; an app resume is
   * rate-limited, because a parent flicking between apps should not re-upload
   * their year every few seconds. */
  force?: boolean
  reader?: PhoneCalendarReader
}

/**
 * Pushes the whole window, in as few chunks as it fits into.
 *
 * Runs never overlap: two snapshots in flight at once would have the older one
 * refused by the server's ordering guard, and a parent tapping "Sync now" while
 * an app-open push is still going is the normal way to produce that.
 */
export function syncPhoneCalendars(options: PhoneSyncOptions = {}): Promise<void> {
  const current = running
  if (current !== null && options.force !== true) return current
  // A forced push queues behind a run in progress rather than joining it. A
  // parent choosing a calendar is exactly the case where the snapshot already
  // in flight predates the change it would otherwise be credited with, leaving
  // the board empty until something else happens to push.
  const run = (current === null ? performSync(options) : current.then(() => performSync(options)))
    .finally(() => { if (running === run) running = null })
  running = run
  return run
}

async function performSync(options: PhoneSyncOptions): Promise<void> {
  const reader = options.reader ?? devicePhoneCalendarReader
  if (!isNativeApp() && options.reader === undefined) {
    publish({ supported: false })
    return
  }
  if (options.force !== true && Date.now() - lastAutomaticPushAt < AUTOMATIC_PUSH_INTERVAL_MS) return

  let permission: CalendarPermission
  try {
    permission = await reader.checkPermission()
  } catch {
    // A phone that will not even answer the permission question has no calendar
    // to share. This is the one place the answer can be neither yes nor no, and
    // it must not become an unhandled rejection in a trigger nobody awaited.
    publish({ supported: true, permission: 'unavailable' })
    return
  }
  publish({ supported: true, permission })
  // Not an error, and deliberately not phrased as one: a parent who has not
  // answered the prompt yet is one tap from doing so, and the panel says how.
  if (permission !== 'granted') return

  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  publish({ phase: 'syncing', lastError: null })

  try {
    const sourceId = await ensureSource(signal)
    const allCalendars = await reader.listCalendars()
    const { shared, omitted } = limitCalendars(allCalendars)
    // Show the catalogue before the push finishes: on a busy phone the upload
    // takes a moment, and "no calendars" is the wrong thing to show meanwhile.
    publish({ calendars: mergeCatalogue(shared), omittedCalendars: omitted })
    if (shared.length === 0) {
      publish({ phase: 'idle', skippedSlices: 0 })
      return
    }

    // Outward writes are applied before the snapshot is read, not after. The
    // other order reads the calendar without the event the board asked for, so
    // the push would reconcile it straight back off the wall until the next run.
    // A failure here is recorded per write on the server and must not abandon
    // the push: a phone that cannot write still has a calendar worth sharing.
    try {
      await drainPhoneWriteQueue(sourceId, signal)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
    }

    const outcome = await pushWindow(sourceId, shared, reader, signal, 0)
    const pushedAt = new Date().toISOString()
    setLastPushedAt(pushedAt)
    lastAutomaticPushAt = Date.now()
    publish({
      phase: 'idle',
      lastPushedAt: pushedAt,
      omittedCalendars: omitted,
      skippedSlices: outcome.skipped,
      calendars: [...outcome.calendars.entries()]
        .map(([sourceCalendarId, calendar]) => ({ sourceCalendarId, name: calendar.name, shared: calendar.shared, events: calendar.identities.size }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      lastError: outcome.skipped === 0
        ? null
        : 'Some days hold more events than one upload can carry, so they were left as they were. Nothing was removed from the board.'
    })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') { publish({ phase: 'idle' }); return }
    publish({ phase: 'idle', lastError: explain(reason) })
  }
}

/**
 * One full-window snapshot, retried once when the server proves this phone's
 * clock is behind its own.
 *
 * The whole window is re-pushed rather than only the refused chunk, because
 * every chunk of a snapshot shares one `pushedAt` and a run with two different
 * timestamps is exactly the out-of-order push the guard exists to refuse.
 */
async function pushWindow(
  sourceId: string,
  calendars: readonly DeviceCalendar[],
  reader: PhoneCalendarReader,
  signal: AbortSignal,
  attempt: number
): Promise<PushOutcome> {
  const outcome: PushOutcome = { calendars: new Map(), skipped: 0 }
  const window = phoneSyncWindow(new Date())
  const pushedAt = new Date(Date.now() + getClockOffsetMs()).toISOString()
  try {
    await pushSliceCollecting(sourceId, window, pushedAt, calendars, reader, signal, outcome)
  } catch (reason) {
    if (reason instanceof ClockBehindServerError && attempt === 0) {
      setClockOffsetMs(correctedPushOffset(reason.serverTimestamps, Date.now(), getClockOffsetMs()))
      return pushWindow(sourceId, calendars, reader, signal, attempt + 1)
    }
    if (reason instanceof ApiError && reason.status === 404 && attempt === 0) {
      // The parent removed this phone's source from another device. Re-creating
      // it is the only way back, and is what the calendar section would do.
      clearPhoneSourceId()
      return pushWindow(await ensureSource(signal), calendars, reader, signal, attempt + 1)
    }
    throw reason
  }
  return outcome
}

/** Keeps a slice that cannot be shrunk any further from failing the whole
 * window. A skipped slice pushes nothing, so it deletes nothing: those days
 * stay exactly as the board last saw them. */
async function pushSliceCollecting(
  sourceId: string,
  slice: TimeRange,
  pushedAt: string,
  calendars: readonly DeviceCalendar[],
  reader: PhoneCalendarReader,
  signal: AbortSignal,
  outcome: PushOutcome
): Promise<void> {
  try {
    await pushSlice(sourceId, slice, pushedAt, calendars, reader, signal, 0, outcome)
  } catch (reason) {
    if (reason instanceof SliceTooLargeError) { outcome.skipped += 1; return }
    throw reason
  }
}

/** What the parent already knows about a calendar survives a re-read of the
 * device's catalogue, so the list does not flicker back to "not shared" every
 * time the app is opened. */
function mergeCatalogue(calendars: readonly DeviceCalendar[]): PhoneSyncCalendarState[] {
  const known = new Map(state.calendars.map((calendar) => [calendar.sourceCalendarId, calendar]))
  return calendars
    .map((calendar) => {
      const previous = known.get(calendar.id)
      return {
        sourceCalendarId: calendar.id,
        name: calendarDisplayName(calendar),
        shared: previous?.shared ?? false,
        events: previous?.events ?? 0
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Asks the operating system where permission stands, without pushing. The
 * panel needs this on mount, when nothing is due to be uploaded yet. */
export async function refreshPhoneCalendarPermission(reader: PhoneCalendarReader = devicePhoneCalendarReader): Promise<CalendarPermission> {
  if (!isNativeApp()) { publish({ supported: false }); return 'unavailable' }
  const permission = await reader.checkPermission()
  publish({ supported: true, permission })
  return permission
}

/** Records the parent's answer to the OS prompt and, when it is yes, starts the
 * first upload immediately — a granted permission with nothing on the board is
 * indistinguishable from a broken one. */
export async function grantPhoneCalendarPermission(): Promise<CalendarPermission> {
  let permission: CalendarPermission
  try {
    permission = await requestCalendarPermission()
  } catch {
    publish({ permission: 'unavailable' })
    return 'unavailable'
  }
  publish({ permission })
  if (permission === 'granted') await syncPhoneCalendars({ force: true })
  return permission
}

function explain(reason: unknown): string {
  // Refused as stale twice, having already stepped past the server's own
  // timestamp once. That is not a clock the client can correct on its own.
  if (reason instanceof ClockBehindServerError) {
    return 'This phone’s clock and your household server’s clock disagree, so your calendar was not accepted. Check the date and time on both, then tap Sync now.'
  }
  if (reason instanceof ApiError) {
    if (reason.status === 401) return 'This phone is no longer connected to the household. Connect it again to keep sharing its calendars.'
    if (reason.status === 409) return 'The household server and this phone disagree about the time. Check both clocks, then try again.'
    if (reason.status === 429) return 'The household server is busy. This phone will try again the next time you open the app.'
    return 'The household server would not accept this phone’s calendars. Try again, and check the Displays section if this keeps happening.'
  }
  if (reason instanceof Error && reason.message.includes('permission')) {
    return 'This phone would not let OpenSkyLight read its calendars. Check calendar permission in your phone’s settings.'
  }
  return 'Could not reach the household server. Check this phone is on the same home Wi-Fi, then try again.'
}

/**
 * The triggers the ticket names, and the honest limit behind them: a phone app
 * gets no reliable background execution on Android, so there is no timer here
 * that runs while the app is closed. Freshness tracks how often the app is
 * opened, which is exactly what the panel tells the parent.
 */
export function startPhoneCalendarSyncTriggers(): () => void {
  if (!isNativeApp()) return () => {}
  initialisePhoneSyncState()
  const onVisible = () => { if (document.visibilityState === 'visible') void syncPhoneCalendars() }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  void syncPhoneCalendars({ force: true })
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
    controller?.abort()
    controller = null
  }
}

/** Used when a phone forgets its household: an in-flight push to a server it is
 * no longer paired with has nothing useful left to do. */
export function cancelPhoneCalendarSync(): void {
  controller?.abort()
  controller = null
  publish({ phase: 'idle', calendars: [], lastPushedAt: null, lastError: null, permission: 'unknown', skippedSlices: 0, omittedCalendars: 0 })
}
