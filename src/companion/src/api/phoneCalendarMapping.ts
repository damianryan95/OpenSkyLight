import type { PhoneEventDto, PushPhoneCalendarsRequest } from '@shared/api/contract'
import { DateTime } from 'luxon'

/**
 * Everything about turning this phone's calendar store into a push payload,
 * with nothing platform-specific in it.
 *
 * `N19` swaps the reader in `phoneCalendars.ts` for EventKit and this file is
 * expected to survive untouched, so the two interfaces below describe only the
 * fields both platforms already expose. They are structurally satisfied by the
 * plugin's `Calendar` and `CalendarEvent` without importing them, which is also
 * what lets this module be unit-tested with no device and no plugin.
 */
export interface DeviceCalendar {
  id: string
  title?: string | null
  internalTitle?: string | null
  accountName?: string | null
  color?: string | null
}

export interface DeviceEvent {
  id: string
  calendarId?: string | null
  /** Android: the series master's id. iOS and web: always null. */
  masterId?: string | null
  /** iOS: a cross-device iCalendar identity. Android: always null. */
  calendarItemExternalIdentifier?: string | null
  title?: string | null
  description?: string | null
  location?: string | null
  startDate: number
  endDate?: number | null
  timezone?: string | null
  isAllDay?: boolean | null
  status?: string | null
  /** iOS only; Android's provider exposes no last-modified date at all. */
  lastModifiedDate?: number | null
}

export interface TimeRange {
  start: Date
  end: Date
}

/**
 * The window the board itself renders, and therefore the window a phone has
 * any reason to push. These must match `SYNC_WINDOW_PAST_DAYS` and
 * `SYNC_WINDOW_FUTURE_DAYS` in `src/server/sync/pull.ts`; a server module
 * cannot be imported into a browser bundle, so `tests/unit/phoneCalendarSync`
 * asserts the two stay equal rather than trusting this comment.
 */
export const SYNC_WINDOW_PAST_DAYS = 30
export const SYNC_WINDOW_FUTURE_DAYS = 400

/**
 * Deliberately well under the server's 1 MB `MAX_JSON_BODY_BYTES`. The margin
 * is not timidity: the native HTTP bridge re-serialises the body on its way out
 * of the webview, and a JSON encoder that escapes non-ASCII as `\uXXXX` turns a
 * two-byte character into six. A household writing event titles in a non-Latin
 * script would otherwise discover the limit as a 413 on every push.
 */
export const MAX_PUSH_BYTES = 700_000
/** The contract caps a calendar at 5000 events per push; over it is a 400 that
 * loses the whole chunk, so split well before reaching it. */
export const MAX_EVENTS_PER_CALENDAR = 4_000
/** The contract caps a push at 50 calendars. */
export const MAX_CALENDARS = 50
/** A slice is never halved below this, so a pathological day cannot spin. */
export const MIN_SLICE_MS = 86_400_000

export function phoneSyncWindow(now: Date): TimeRange {
  return {
    start: new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 86_400_000),
    end: new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 86_400_000)
  }
}

/** Halves a slice into two contiguous ranges. Contiguity is load-bearing: a gap
 * between chunks is a stretch of the window no push ever reconciles, so a
 * deleted event there would linger on the wall forever. */
export function splitRange(range: TimeRange): [TimeRange, TimeRange] {
  const midpoint = new Date(range.start.getTime() + Math.floor((range.end.getTime() - range.start.getTime()) / 2))
  return [{ start: range.start, end: midpoint }, { start: midpoint, end: range.end }]
}

export function canSplitRange(range: TimeRange): boolean {
  return range.end.getTime() - range.start.getTime() > MIN_SLICE_MS
}

/**
 * The identity the server reconciles on, and the single most dangerous value in
 * this file: if it is not stable across pushes, every push rewrites every row,
 * and if it collides between two occurrences they overwrite each other.
 *
 * `listEventsInRange` hands back already-expanded occurrences with no
 * recurrence rule attached, so each occurrence must key itself. On Android
 * `masterId` names the series and `id` repeats across its occurrences; on iOS
 * `masterId` is null and `id` carries. The start instant disambiguates in both
 * cases because two occurrences of one series cannot begin at the same moment.
 */
export function sourceEventIdFor(event: DeviceEvent): string {
  const master = typeof event.masterId === 'string' && event.masterId !== '' ? event.masterId : event.id
  return `${master}:${event.startDate}`
}

function trimmed(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  // Truncation rather than rejection: an over-long description would fail the
  // contract's validation and take the entire chunk — every other event in that
  // window with it — down as a 400.
  return text.length > max ? text.slice(0, max) : text
}

function isoOrNull(millis: number | null | undefined): string | null {
  if (typeof millis !== 'number' || !Number.isFinite(millis)) return null
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** The plugin's `EventStatus` is `none | confirmed | tentative | canceled`, and
 * other platforms spell cancellation differently. Only an explicit cancellation
 * hides an event from the board, so anything unrecognised stays confirmed. */
function statusOf(status: string | null | undefined): 'confirmed' | 'cancelled' {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : ''
  return value === 'canceled' || value === 'cancelled' ? 'cancelled' : 'confirmed'
}

function timezoneOf(event: DeviceEvent, deviceTimezone: string): string {
  const candidate = typeof event.timezone === 'string' ? event.timezone.trim() : ''
  // A timezone is an identifier, not prose: truncating an over-long one would
  // produce a name nothing can resolve, so fall back instead.
  if (candidate !== '' && candidate.length <= 100) return candidate
  return deviceTimezone.length > 0 && deviceTimezone.length <= 100 ? deviceTimezone : 'UTC'
}

/**
 * Android keeps an all-day event as midnight UTC on its date to midnight UTC on
 * the day after, whatever timezone the household is in - and it labels the event
 * "UTC" for good measure. The board, iCal feeds and the wall's own editor all
 * mean midnight in the household's zone, so pushed as-is the event began at
 * 01:00 in London and touched two days. Read the calendar date off the UTC
 * instant and place it at local midnight instead.
 */
export function allDayInstantFromDevice(millis: number, zone: string): string {
  const utc = DateTime.fromMillis(millis, { zone: 'utc' })
  return DateTime.fromObject({ year: utc.year, month: utc.month, day: utc.day }, { zone }).startOf('day').toUTC().toISO()!
}

/**
 * One device occurrence as the contract wants it, or null when it cannot be
 * represented at all — an event with no usable start has nowhere to sit on a
 * board organised entirely by time.
 *
 * Every recurrence field is null on purpose. The platform hands back expanded
 * occurrences and exposes no rule, so each occurrence is pushed as its own
 * event. Inventing an RRULE from what is visible in the window would expand
 * differently on the server and put events on the wall that are not in the
 * phone's calendar.
 */
export function toPhoneEvent(event: DeviceEvent, deviceTimezone: string): PhoneEventDto | null {
  const startAt = isoOrNull(event.startDate)
  if (startAt === null) return null
  const sourceEventId = sourceEventIdFor(event)
  if (sourceEventId.length > 512) return null
  const endAt = isoOrNull(event.endDate) ?? startAt
  const icalUid = trimmed(event.calendarItemExternalIdentifier, 512)
  const allDay = event.isAllDay === true
  // Android's "UTC" on an all-day event is a storage convention, not where the
  // household lives; the phone's own zone is the honest answer.
  const timezone = allDay ? timezoneOf({ ...event, timezone: null }, deviceTimezone) : timezoneOf(event, deviceTimezone)
  const times = allDay
    ? allDayTimes(event.startDate, event.endDate, timezone)
    : {
        startAt,
        // An end before its start is a provider glitch; a zero-length event is
        // still renderable, an inverted one is not.
        endAt: Date.parse(endAt) < Date.parse(startAt) ? startAt : endAt
      }
  return {
    sourceEventId,
    icalUid,
    title: trimmed(event.title, 1000) ?? '',
    description: trimmed(event.description, 20_000),
    location: trimmed(event.location, 1000),
    ...times,
    timezone,
    allDay,
    recurrence: null,
    recurrenceExdates: null,
    recurrenceRdates: null,
    recurringEventId: null,
    originalStartAt: null,
    status: statusOf(event.status),
    remoteUpdatedAt: isoOrNull(event.lastModifiedDate)
  }
}

function allDayTimes(startMillis: number, endMillis: number | null | undefined, zone: string): { startAt: string; endAt: string } {
  const startAt = allDayInstantFromDevice(startMillis, zone)
  const start = DateTime.fromISO(startAt, { zone: 'utc' })
  const endCandidate = typeof endMillis === 'number' && Number.isFinite(endMillis) ? allDayInstantFromDevice(endMillis, zone) : null
  // The end is exclusive, so a one-day event ends at the next midnight. A
  // missing or inverted end is the same provider glitch as for timed events.
  const endAt = endCandidate !== null && DateTime.fromISO(endCandidate, { zone: 'utc' }) > start
    ? endCandidate
    : start.plus({ days: 1 }).toISO()!
  return { startAt, endAt }
}

export function calendarDisplayName(calendar: DeviceCalendar): string {
  const name = trimmed(calendar.title, 200) ?? trimmed(calendar.internalTitle, 200) ?? trimmed(calendar.accountName, 200)
  return name ?? `Calendar ${calendar.id}`
}

/**
 * Keeps the push inside the contract's 50-calendar limit. Over it the server
 * rejects the whole payload, so a phone holding more calendars than that must
 * choose — and the choice has to be stable between pushes, or calendars would
 * take turns appearing and being reconciled away.
 */
export function limitCalendars(calendars: readonly DeviceCalendar[]): { shared: DeviceCalendar[]; omitted: number } {
  if (calendars.length <= MAX_CALENDARS) return { shared: [...calendars], omitted: 0 }
  const ordered = [...calendars].sort((left, right) => {
    const byName = calendarDisplayName(left).localeCompare(calendarDisplayName(right))
    return byName !== 0 ? byName : left.id.localeCompare(right.id)
  })
  return { shared: ordered.slice(0, MAX_CALENDARS), omitted: ordered.length - MAX_CALENDARS }
}

/**
 * Groups a slice's events under the calendars they came from.
 *
 * Every calendar appears, including ones with nothing in this slice. That empty
 * list is not padding: it is how a calendar whose last event in this window was
 * deleted gets that deletion reconciled. Omitting it would leave the event on
 * the wall until something else happened to touch that calendar.
 */
export function buildCalendarPayloads(
  calendars: readonly DeviceCalendar[],
  events: readonly DeviceEvent[],
  deviceTimezone: string
): PushPhoneCalendarsRequest['calendars'] {
  const grouped = new Map<string, PhoneEventDto[]>(calendars.map((calendar) => [calendar.id, []]))
  const seen = new Map<string, Set<string>>(calendars.map((calendar) => [calendar.id, new Set<string>()]))
  for (const event of events) {
    const calendarId = typeof event.calendarId === 'string' ? event.calendarId : null
    if (calendarId === null) continue
    const bucket = grouped.get(calendarId)
    const identities = seen.get(calendarId)
    // An event from a calendar we are not pushing has no home here; pushing it
    // under any other calendar would attribute it to the wrong person.
    if (bucket === undefined || identities === undefined) continue
    const mapped = toPhoneEvent(event, deviceTimezone)
    if (mapped === null) continue
    // Overlapping slices can legitimately return the same occurrence twice, and
    // a duplicate identity inside one calendar would silently overwrite itself.
    if (identities.has(mapped.sourceEventId)) continue
    identities.add(mapped.sourceEventId)
    bucket.push(mapped)
  }
  return calendars.map((calendar) => {
    const color = trimmed(calendar.color, 40)
    return {
      sourceCalendarId: calendar.id,
      name: calendarDisplayName(calendar),
      ...(color === null ? {} : { color }),
      events: grouped.get(calendar.id) ?? []
    }
  })
}

export function buildPushRequest(
  pushedAt: string,
  slice: TimeRange,
  calendars: readonly DeviceCalendar[],
  events: readonly DeviceEvent[],
  deviceTimezone: string
): PushPhoneCalendarsRequest {
  return {
    pushedAt,
    // The window is the other value that loses a household's events when it is
    // wrong: the server reconciles inside exactly this range, so it must
    // describe the slice that was actually read, never the whole window.
    window: { start: slice.start.toISOString(), end: slice.end.toISOString() },
    calendars: buildCalendarPayloads(calendars, events, deviceTimezone)
  }
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Why a payload cannot be sent as one chunk, or null when it can. */
export function oversizeReason(request: PushPhoneCalendarsRequest): 'bytes' | 'events' | 'calendars' | null {
  if (request.calendars.length > MAX_CALENDARS) return 'calendars'
  if (request.calendars.some((calendar) => calendar.events.length > MAX_EVENTS_PER_CALENDAR)) return 'events'
  return byteLength(JSON.stringify(request)) > MAX_PUSH_BYTES ? 'bytes' : null
}

/** A phone whose clock sits behind the server's is refused for good, because
 * every push it makes looks older than one already applied. The server hands
 * back its own value precisely so the phone can step over it once rather than
 * retry the same losing comparison forever. */
export function correctedPushOffset(
  staleTimestamps: readonly string[],
  now: number,
  currentOffsetMs: number
): number {
  const newest = staleTimestamps
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))
    .reduce((highest, value) => Math.max(highest, value), Number.NEGATIVE_INFINITY)
  if (!Number.isFinite(newest)) return currentOffsetMs
  // One second past the server's own value: enough to win the comparison,
  // small enough that the timestamps stay recognisable to a human reading them.
  const required = newest + 1000 - now
  if (required <= currentOffsetMs) return currentOffsetMs
  // A year of correction is not a clock difference, it is a corrupt value, and
  // adopting it would stamp every future push with a nonsense date.
  return Math.min(required, 365 * 86_400_000)
}
