import { CalendarPermissionScope, CapacitorCalendar } from '@ebarooni/capacitor-calendar'
import { isNativeApp } from './client'
import type { DeviceCalendar, DeviceEvent, TimeRange } from './phoneCalendarMapping'

/**
 * The only file in the companion that knows how this phone stores calendars.
 * Everything above it deals in `DeviceCalendar` and `DeviceEvent`, which is the
 * seam `N19` replaces wholesale when EventKit arrives.
 *
 * Read-only by construction. The board cannot write into a phone's calendar
 * store — that is `N06` — so nothing here asks for write access, and the app
 * asks the household for one permission it can justify rather than two.
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
 */
export async function requestCalendarPermission(): Promise<CalendarPermission> {
  if (!phoneCalendarsAvailable()) return 'unavailable'
  const { result } = await CapacitorCalendar.requestReadOnlyCalendarAccess()
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
