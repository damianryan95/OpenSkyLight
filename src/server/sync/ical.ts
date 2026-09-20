import ICAL from 'ical.js'
import { DateTime } from 'luxon'
import { normalizeTimeZone } from '../../shared/timezone'

/**
 * A VEVENT reduced to the cache's row shape. Times are stored as UTC instants
 * alongside the IANA zone the recurrence pattern lives in, so expansion can
 * reproduce wall-clock behaviour across DST without re-reading the source.
 */
export interface CachedIcalEvent {
  sourceEventId: string
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
  recurringEventId: string | null
  originalStartAt: string | null
  status: 'confirmed' | 'cancelled'
  remoteUpdatedAt: string | null
}

export class IcalParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IcalParseError'
  }
}

function utcIso(value: DateTime): string {
  const iso = value.toUTC().toISO({ suppressMilliseconds: true })
  if (iso === null) throw new IcalParseError('Event time could not be converted to UTC.')
  return iso
}

/**
 * Converts an ICAL.Time to a UTC instant using Luxon rather than ical.js's own
 * timezone engine, which would require every VTIMEZONE to be registered first.
 * The wall-clock fields are authoritative; the zone comes from TZID.
 */
function toUtc(time: ICAL.Time, zone: string): string {
  const value = DateTime.fromObject(
    { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second },
    { zone }
  )
  if (!value.isValid) throw new IcalParseError('Event time is invalid.')
  return utcIso(value)
}

function zoneOf(property: ICAL.Property | null, time: ICAL.Time | null, fallback: string): string {
  const tzid = property?.getParameter('tzid')
  if (typeof tzid === 'string' && tzid.length > 0) return normalizeTimeZone(tzid, fallback)
  const zoneId = time?.zone?.tzid
  if (zoneId === 'Z' || zoneId === 'UTC') return 'UTC'
  // A floating time has no zone of its own and takes the household's.
  return fallback
}

function readTime(component: ICAL.Component, name: string, fallback: string): { at: string; timezone: string; allDay: boolean } | null {
  const property = component.getFirstProperty(name)
  if (property === null) return null
  const time = property.getFirstValue() as ICAL.Time | null
  if (time === null || typeof time.toJSDate !== 'function') return null
  const timezone = zoneOf(property, time, fallback)
  if (time.isDate) {
    const value = DateTime.fromObject({ year: time.year, month: time.month, day: time.day }, { zone: fallback }).startOf('day')
    if (!value.isValid) throw new IcalParseError('All-day event date is invalid.')
    return { at: utcIso(value), timezone: fallback, allDay: true }
  }
  return { at: toUtc(time, timezone), timezone, allDay: false }
}

function readDateList(component: ICAL.Component, name: string, fallback: string): string[] {
  const values: string[] = []
  for (const property of component.getAllProperties(name)) {
    const timezone = zoneOf(property, null, fallback)
    for (const time of property.getValues() as ICAL.Time[]) {
      if (time === null || typeof time.toJSDate !== 'function') continue
      values.push(time.isDate
        ? utcIso(DateTime.fromObject({ year: time.year, month: time.month, day: time.day }, { zone: fallback }).startOf('day'))
        : toUtc(time, timezone))
    }
  }
  return values
}

function text(component: ICAL.Component, name: string): string | null {
  const value = component.getFirstPropertyValue(name)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Maps one VEVENT. Returns null rather than throwing when the component is
 * unusable, so a single malformed event cannot fail an entire sync.
 */
export function mapIcalEvent(component: ICAL.Component, householdTimezone: string, etag: string | null = null): CachedIcalEvent | null {
  try {
    const uid = text(component, 'uid')
    if (uid === null) return null
    const fallback = normalizeTimeZone(householdTimezone)
    const start = readTime(component, 'dtstart', fallback)
    if (start === null) return null

    const recurrenceId = component.getFirstProperty('recurrence-id')
    const recurrenceIdTime = recurrenceId === null ? null : readTime(component, 'recurrence-id', fallback)
    // An exception shares its master's UID, so the occurrence it overrides has
    // to be part of the identity or the two rows collide on one unique key.
    const sourceEventId = recurrenceIdTime === null ? uid : `${uid}::${recurrenceIdTime.at}`

    let endAt: string
    const end = readTime(component, 'dtend', fallback)
    if (end !== null) {
      endAt = end.at
    } else {
      const duration = component.getFirstPropertyValue('duration') as ICAL.Duration | null
      const seconds = duration !== null && typeof duration.toSeconds === 'function' ? duration.toSeconds() : null
      endAt = seconds !== null
        ? utcIso(DateTime.fromISO(start.at, { zone: 'utc' }).plus({ seconds }))
        : utcIso(DateTime.fromISO(start.at, { zone: 'utc' }).plus(start.allDay ? { days: 1 } : { hours: 1 }))
    }

    const rrule = component.getFirstPropertyValue('rrule') as ICAL.Recur | null
    const recurrence = rrule !== null && typeof rrule.toString === 'function' ? rrule.toString() : null
    const exdates = readDateList(component, 'exdate', fallback)
    const rdates = readDateList(component, 'rdate', fallback)
    const status = String(text(component, 'status') ?? '').toUpperCase() === 'CANCELLED' ? 'cancelled' : 'confirmed'
    const updated = readTime(component, 'last-modified', fallback) ?? readTime(component, 'dtstamp', fallback)

    return {
      sourceEventId,
      etag,
      icalUid: uid,
      title: text(component, 'summary') ?? '',
      description: text(component, 'description'),
      location: text(component, 'location'),
      startAt: start.at,
      endAt,
      timezone: start.timezone,
      allDay: start.allDay,
      recurrence,
      recurrenceExdates: exdates.length > 0 ? JSON.stringify(exdates) : null,
      recurrenceRdates: rdates.length > 0 ? JSON.stringify(rdates) : null,
      recurringEventId: recurrenceIdTime === null ? null : uid,
      originalStartAt: recurrenceIdTime?.at ?? null,
      status,
      remoteUpdatedAt: updated?.at ?? null
    }
  } catch {
    return null
  }
}

/** Parses one iCalendar document into its VEVENT components. */
export function parseCalendar(body: string): ICAL.Component[] {
  let parsed: unknown
  try {
    parsed = ICAL.parse(body)
  } catch {
    throw new IcalParseError('The calendar document could not be parsed.')
  }
  const root = new ICAL.Component(parsed as never)
  const components = root.name === 'vcalendar' ? root.getAllSubcomponents('vevent') : []
  return components
}

/** Maps a whole iCalendar document, skipping components that cannot be read. */
export function mapCalendarDocument(body: string, householdTimezone: string, etag: string | null = null): CachedIcalEvent[] {
  return parseCalendar(body)
    .map((component) => mapIcalEvent(component, householdTimezone, etag))
    .filter((event): event is CachedIcalEvent => event !== null)
}
