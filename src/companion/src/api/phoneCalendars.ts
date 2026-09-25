import { CalendarPermissionScope, CapacitorCalendar } from '@ebarooni/capacitor-calendar'
import { isNativeApp } from './client'
import type { DeviceCalendar, DeviceEvent, TimeRange } from './phoneCalendarMapping'

/**
 * The only file in the companion that knows how this phone stores calendars.
 * Everything above it deals in `DeviceCalendar` and `DeviceEvent`, which is the
 * seam `N19` replaces wholesale when EventKit arrives.
 *
 * Reads and writes since `N06`. Write access is asked for in the same prompt as
 * read, because the two are one permission group on Android and a household
 * should be asked once; the board cannot reach a phone's calendar store itself,
 * so this is the only place an outward write can actually happen.
 */

/** `prompt` includes Android's "ask again with a reason" state: both mean the
 * parent has not answered yet, and both are answered by the same button. */
export type CalendarPermission = 'granted' | 'denied' | 'prompt' | 'unavailable'

function normalisePermission(state: string): CalendarPermission {
  if (state === 'granted' || state === 'limited') return 'granted'
  if (state === 'denied') return 'denied'
  return 'prompt'
}

/** The browser at `/admin/` is a web page on a wall-mounted box's network, not
 * a phone: it has no calendar store to read and must never touch the plugin. */
export function phoneCalendarsAvailable(): boolean {
  return isNativeApp()
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export async function checkCalendarPermission(): Promise<CalendarPermission> {
  if (!phoneCalendarsAvailable()) return 'unavailable'
  const { result } = await CapacitorCalendar.checkPermission({ scope: CalendarPermissionScope.READ_CALENDAR })
  return normalisePermission(result)
}

/**
 * Asks the operating system, once. A second refusal on Android is permanent
 * until the parent changes it in system settings, which is why the caller has
 * to be able to tell `denied` from `prompt` and say something different about
 * each.
 *
 * Full access rather than read-only since `N06`: reading and writing calendars
 * are one permission group on Android, and asking for write later would mean a
 * second prompt for something the parent has already agreed to in substance.
 */
export async function requestCalendarPermission(): Promise<CalendarPermission> {
  if (!phoneCalendarsAvailable()) return 'unavailable'
  const { result } = await CapacitorCalendar.requestFullCalendarAccess()
  return normalisePermission(result)
}

export async function listDeviceCalendars(): Promise<DeviceCalendar[]> {
  if (!phoneCalendarsAvailable()) return []
  const { result } = await CapacitorCalendar.listCalendars()
  return result.filter((calendar) => typeof calendar.id === 'string' && calendar.id !== '')
}

/**
 * Reads one slice of the window. The platform returns already-expanded
 * occurrences — an event that overlaps the slice is included even when it began
 * before it — and carries no recurrence rule, so what comes back is exactly
 * what the board should show and nothing has to be expanded twice.
 */
export async function listDeviceEvents(slice: TimeRange): Promise<DeviceEvent[]> {
  if (!phoneCalendarsAvailable()) return []
  const { result } = await CapacitorCalendar.listEventsInRange({ from: slice.start.getTime(), to: slice.end.getTime() })
  return result
}

/**
 * Whether this phone will accept a write. Checked against WRITE_CALENDAR rather
 * than inferred from the read permission, because Android grants the two
 * independently and a parent can revoke one in system settings.
 */
export async function checkCalendarWritePermission(): Promise<CalendarPermission> {
  if (!phoneCalendarsAvailable()) return 'unavailable'
  const { result } = await CapacitorCalendar.checkPermission({ scope: CalendarPermissionScope.WRITE_CALENDAR })
  return normalisePermission(result)
}

/** One event to write into this phone's calendar store. Times are instants. */
export interface DeviceEventDraft {
  calendarId: string
  title: string
  description: string | null
  location: string | null
  startAt: number
  endAt: number
  allDay: boolean
  recurrence: DeviceRecurrence | null
}

/** The plugin takes a structured rule, not an RRULE string. Weekdays are
 * 1 = Monday to 7 = Sunday, which is not the board's own numbering. */
export interface DeviceRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval?: number
  byWeekDay?: number[]
  end?: number
  count?: number
}

/** Creates the event and returns the id this phone assigned it. That id is what
 * the board records, so its own push of the same event is recognised rather than
 * shown twice. */
export async function createDeviceEvent(draft: DeviceEventDraft): Promise<string | null> {
  const { id } = await CapacitorCalendar.createEvent({
    calendarId: draft.calendarId,
    title: draft.title,
    ...(draft.description === null ? {} : { description: draft.description }),
    ...(draft.location === null ? {} : { location: draft.location }),
    startDate: draft.startAt,
    endDate: draft.endAt,
    isAllDay: draft.allDay,
    ...(draft.recurrence === null ? {} : { recurrence: draft.recurrence })
  })
  return typeof id === 'string' && id !== '' ? id : null
}

export async function modifyDeviceEvent(id: string, draft: DeviceEventDraft): Promise<void> {
  await CapacitorCalendar.modifyEvent({
    id,
    title: draft.title,
    ...(draft.description === null ? {} : { description: draft.description }),
    ...(draft.location === null ? {} : { location: draft.location }),
    startDate: draft.startAt,
    endDate: draft.endAt,
    isAllDay: draft.allDay,
    ...(draft.recurrence === null ? {} : { recurrence: draft.recurrence })
  })
}

export async function deleteDeviceEvent(id: string): Promise<void> {
  await CapacitorCalendar.deleteEvent({ id })
}

export interface PhoneCalendarWriter {
  checkPermission: () => Promise<CalendarPermission>
  create: (draft: DeviceEventDraft) => Promise<string | null>
  modify: (id: string, draft: DeviceEventDraft) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const devicePhoneCalendarWriter: PhoneCalendarWriter = {
  checkPermission: checkCalendarWritePermission,
  create: createDeviceEvent,
  modify: modifyDeviceEvent,
  remove: deleteDeviceEvent
}

export interface PhoneCalendarReader {
  timezone: () => string
  listCalendars: () => Promise<DeviceCalendar[]>
  listEvents: (slice: TimeRange) => Promise<DeviceEvent[]>
  checkPermission: () => Promise<CalendarPermission>
}

export const devicePhoneCalendarReader: PhoneCalendarReader = {
  timezone: deviceTimezone,
  listCalendars: listDeviceCalendars,
  listEvents: listDeviceEvents,
  checkPermission: checkCalendarPermission
}
