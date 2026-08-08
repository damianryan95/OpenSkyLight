import { DateTime } from 'luxon'
import { normalizeTimeZone } from '../../../shared/timezone'

/** The subset of an Events resource needed by the read-only local cache. */
export interface GoogleEventResource {
  id?: string | null
  status?: string | null
  etag?: string | null
  iCalUID?: string | null
  summary?: string | null
  description?: string | null
  location?: string | null
  start?: GoogleEventTime | null
  end?: GoogleEventTime | null
  recurrence?: string[] | null
  recurringEventId?: string | null
  originalStartTime?: GoogleEventTime | null
  updated?: string | null
}

export interface GoogleEventTime {
  date?: string | null
  dateTime?: string | null
  timeZone?: string | null
}

export interface CachedGoogleEvent {
  googleEventId: string
  etag: string | null
  icalUid: string | null
  title: string
  description: string | null
  location: string | null
  startAt: string
  endAt: string
  timezone: string
  allDay: boolean
  recurrence: string | null
  recurrenceExdates: string | null
  recurrenceRdates: string | null
  recurringGoogleEventId: string | null
  originalStartAt: string | null
  status: 'confirmed' | 'cancelled'
  remoteUpdatedAt: string | null
  /** Cancelled delta resources may omit their original event times. */
  hasTiming: boolean
}

function utcIso(value: DateTime): string {
  return value.toUTC().toISO({ suppressMilliseconds: true })!
}

function mapTime(time: GoogleEventTime, fallbackTimezone: string): { value: string; timezone: string; allDay: boolean } {
  const fallback = normalizeTimeZone(fallbackTimezone)
  if (time.date) {
    const value = DateTime.fromISO(time.date, { zone: fallback }).startOf('day')
    if (!value.isValid) throw new Error('Google all-day event date is invalid.')
    return { value: utcIso(value), timezone: fallback, allDay: true }
  }
  if (!time.dateTime) throw new Error('Google event time is missing.')
  const value = DateTime.fromISO(time.dateTime, { setZone: true })
  if (!value.isValid) throw new Error('Google event date-time is invalid.')
  return { value: utcIso(value), timezone: normalizeTimeZone(time.timeZone, fallback), allDay: false }
}

function parseRecurrence(lines: readonly string[] | null | undefined, timezone: string): Pick<CachedGoogleEvent, 'recurrence' | 'recurrenceExdates' | 'recurrenceRdates'> {
  let recurrence: string | null = null
  const exdates: string[] = []
  const rdates: string[] = []
  for (const line of lines ?? []) {
    if (/^RRULE:/i.test(line)) {
      recurrence ??= line.slice(6)
      continue
    }
    const match = /^(EXDATE|RDATE)([^:]*):(.*)$/i.exec(line)
    if (!match) continue
    const timezoneId = normalizeTimeZone(/TZID=([^;:]+)/i.exec(match[2])?.[1], timezone)
    const target = match[1].toUpperCase() === 'EXDATE' ? exdates : rdates
    for (const raw of match[3].split(',')) {
      const source = raw.trim()
      const date = /^\d{8}$/.test(source)
        ? DateTime.fromFormat(source, 'yyyyMMdd', { zone: timezoneId }).startOf('day')
        : source.endsWith('Z')
          ? DateTime.fromFormat(source, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' })
          : DateTime.fromFormat(source, "yyyyMMdd'T'HHmmss", { zone: timezoneId })
      if (date.isValid) target.push(utcIso(date))
    }
  }
  return {
    recurrence,
    recurrenceExdates: exdates.length ? JSON.stringify(exdates) : null,
    recurrenceRdates: rdates.length ? JSON.stringify(rdates) : null
  }
}

/** Maps a synthetic or API Google resource without any OpenSkyLight write metadata. */
export function mapGoogleEvent(resource: GoogleEventResource, fallbackTimezone: string): CachedGoogleEvent | null {
  if (!resource.id) return null
  const cancelled = resource.status === 'cancelled'
  const original = resource.originalStartTime ? mapTime(resource.originalStartTime, fallbackTimezone) : null
  if (cancelled && (!resource.start || !resource.end) && !original) {
    return {
      googleEventId: resource.id, etag: resource.etag ?? null, icalUid: resource.iCalUID ?? null,
      title: resource.summary ?? '(no title)', description: resource.description ?? null, location: resource.location ?? null,
      startAt: '1970-01-01T00:00:00Z', endAt: '1970-01-01T00:00:00Z', timezone: fallbackTimezone, allDay: false,
      ...parseRecurrence(resource.recurrence, fallbackTimezone), recurringGoogleEventId: resource.recurringEventId ?? null,
      originalStartAt: null, status: 'cancelled', remoteUpdatedAt: resource.updated ?? null, hasTiming: false
    }
  }
  if (!cancelled && (!resource.start || !resource.end)) return null
  const start = resource.start ? mapTime(resource.start, fallbackTimezone) : original!
  const end = resource.end ? mapTime(resource.end, fallbackTimezone) : original!
  return {
    googleEventId: resource.id,
    etag: resource.etag ?? null,
    icalUid: resource.iCalUID ?? null,
    title: resource.summary ?? '(no title)',
    description: resource.description ?? null,
    location: resource.location ?? null,
    startAt: start.value,
    endAt: end.value,
    timezone: start.timezone,
    allDay: start.allDay,
    ...parseRecurrence(resource.recurrence, start.timezone),
    recurringGoogleEventId: resource.recurringEventId ?? null,
    originalStartAt: original?.value ?? null,
    status: cancelled ? 'cancelled' : 'confirmed',
    remoteUpdatedAt: resource.updated ?? null,
    hasTiming: true
  }
}
