import ICAL from 'ical.js'
import { DateTime } from 'luxon'
import { normalizeTimeZone } from '../../shared/timezone'

/**
 * Serialises an event the board owns into an iCalendar document a CalDAV
 * collection will accept. Deliberately the inverse of `mapIcalEvent` in
 * `ical.ts`: anything written here must read back as the same row, and the
 * round-trip test is what proves it.
 *
 * Composition through ical.js rather than string concatenation, so escaping of
 * commas and semicolons in a title, and the 75-octet line folding, are the
 * library's problem rather than a defect waiting for a location called
 * "Nan's, upstairs".
 */

/** An event as the write path knows it: UTC instants plus the zone its
 * recurrence pattern lives in, matching the cache's own row shape. */
export interface WritableEvent {
  icalUid: string
  title: string
  description: string | null
  location: string | null
  /** UTC ISO instant. */
  startAt: string
  /** UTC ISO instant. */
  endAt: string
  timezone: string
  allDay: boolean
  /** RRULE body without the property name, e.g. `FREQ=WEEKLY;BYDAY=MO`. */
  recurrence: string | null
  /** UTC ISO instants excluded from the expansion. */
  recurrenceExdates: readonly string[] | null
  /** The master's UID when this document is a single-occurrence override. */
  recurringEventId: string | null
  /** The occurrence such an override replaces, as a UTC ISO instant. */
  originalStartAt: string | null
  status: 'confirmed' | 'cancelled'
}

const PRODUCT_ID = '-//OpenSkyLight//Household Calendar//EN'

const ICAL_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

function localDateTime(instantUtc: string, zone: string): DateTime {
  const value = DateTime.fromISO(instantUtc, { zone: 'utc' }).setZone(zone)
  if (!value.isValid) throw new Error('Event time could not be converted to the event timezone.')
  return value
}

/** A floating wall-clock time. The TZID parameter, set by the caller, is what
 * anchors it; ical.js would otherwise need the zone registered to build one. */
function wallClockTime(value: DateTime, isDate: boolean): ICAL.Time {
  return ICAL.Time.fromData(isDate
    ? { year: value.year, month: value.month, day: value.day, isDate: true }
    : { year: value.year, month: value.month, day: value.day, hour: value.hour, minute: value.minute, second: value.second, isDate: false })
}

function utcTime(instantUtc: string): ICAL.Time {
  const value = DateTime.fromISO(instantUtc, { zone: 'utc' })
  if (!value.isValid) throw new Error('Event time is not a valid instant.')
  return ICAL.Time.fromData(
    { year: value.year, month: value.month, day: value.day, hour: value.hour, minute: value.minute, second: value.second, isDate: false },
    ICAL.Timezone.utcTimezone
  )
}

function offsetString(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const total = Math.abs(minutes)
  return `${sign}${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}`
}

interface ZoneTransition {
  /** Local wall-clock instant at which the new offset begins. */
  at: DateTime
  offsetBefore: number
  offsetAfter: number
  /** Whether the period starting here is the daylight one. */
  daylight: boolean
}

/**
 * Finds the offset changes a zone makes during one year, by scanning days and
 * then narrowing to the hour. Cheap enough to do per write — it only runs for a
 * recurring timed event — and it avoids shipping a second copy of the timezone
 * database when Luxon already has one.
 */
function transitionsIn(zone: string, year: number): ZoneTransition[] {
  const transitions: ZoneTransition[] = []
  let previous: DateTime = DateTime.fromObject({ year, month: 1, day: 1, hour: 0 }, { zone })
  if (!previous.isValid) return transitions

  for (let day = 1; day <= 366; day += 1) {
    const candidate: DateTime = previous.plus({ days: 1 })
    if (candidate.year !== year) break
    if (candidate.offset !== previous.offset) {
      // Narrow to the hour the change actually happened, so the emitted
      // DTSTART is the real transition time rather than midnight.
      let low = previous
      for (let hour = 0; hour < 24; hour += 1) {
        const next = low.plus({ hours: 1 })
        if (next.offset !== low.offset) {
          transitions.push({
            at: next,
            offsetBefore: low.offset,
            offsetAfter: next.offset,
            daylight: next.isInDST
          })
          break
        }
        low = next
      }
    }
    previous = candidate
  }
  return transitions
}

/** `BYDAY` for the nth weekday of a month, or the last one. */
function byDayRule(value: DateTime): string {
  const weekday = ICAL_WEEKDAYS[value.weekday % 7]
  const occurrence = Math.ceil(value.day / 7)
  const isLast = value.day + 7 > value.daysInMonth!
  return `${isLast ? -1 : occurrence}${weekday}`
}

function observance(name: 'standard' | 'daylight', transition: ZoneTransition, zone: string): ICAL.Component {
  const component = new ICAL.Component(name)
  component.addPropertyWithValue('dtstart', wallClockTime(transition.at, false))
  component.addPropertyWithValue('tzoffsetfrom', offsetString(transition.offsetBefore))
  component.addPropertyWithValue('tzoffsetto', offsetString(transition.offsetAfter))
  const abbreviation = transition.at.setZone(zone).toFormat('ZZZZ')
  if (abbreviation.length > 0) component.addPropertyWithValue('tzname', abbreviation)
  component.addPropertyWithValue('rrule', ICAL.Recur.fromString(`FREQ=YEARLY;BYMONTH=${transition.at.month};BYDAY=${byDayRule(transition.at)}`))
  return component
}

/**
 * A VTIMEZONE for the zone, derived from the transitions of the event's own
 * year. Required by RFC 5545 for any TZID a document references, and some
 * servers reject a document without it.
 *
 * Returns null when the zone does not change offset, or when it cannot be
 * characterised — the caller then writes plain UTC instants instead of failing
 * the write outright.
 */
export function buildVTimezone(zone: string, year: number): ICAL.Component | null {
  const transitions = transitionsIn(zone, year)
  if (transitions.length === 0) return null
  const component = new ICAL.Component('vtimezone')
  component.addPropertyWithValue('tzid', zone)
  for (const transition of transitions) {
    component.addSubcomponent(observance(transition.daylight ? 'daylight' : 'standard', transition, zone))
  }
  return component
}

/**
 * How a timed event's start and end are written.
 *
 * A single event is written as a UTC instant: one moment is one moment, and no
 * zone information is needed to say so. A *recurring* event cannot be, because
 * an RRULE on a UTC start expands at fixed offsets and a weekly 09:00 would
 * slide to 08:00 across a DST boundary in the parent's own calendar app. Those
 * carry TZID and a VTIMEZONE so the wall-clock time is what repeats.
 */
function appendTimes(vevent: ICAL.Component, event: WritableEvent, zone: string, useZonedTimes: boolean): void {
  if (event.allDay) {
    // DATE values are floating by definition, which is what an all-day event is.
    const start = localDateTime(event.startAt, zone)
    const end = localDateTime(event.endAt, zone)
    vevent.addPropertyWithValue('dtstart', wallClockTime(start, true))
    // DTEND is exclusive; a same-day all-day event still has to cover one day.
    const exclusiveEnd = end.startOf('day') <= start.startOf('day') ? start.startOf('day').plus({ days: 1 }) : end.startOf('day')
    vevent.addPropertyWithValue('dtend', wallClockTime(exclusiveEnd, true))
    return
  }

  if (!useZonedTimes) {
    vevent.addPropertyWithValue('dtstart', utcTime(event.startAt))
    vevent.addPropertyWithValue('dtend', utcTime(event.endAt))
    return
  }

  for (const [name, instant] of [['dtstart', event.startAt], ['dtend', event.endAt]] as const) {
    const property = new ICAL.Property(name, vevent)
    property.setValue(wallClockTime(localDateTime(instant, zone), false))
    property.setParameter('tzid', zone)
    vevent.addProperty(property)
  }
}

/**
 * One event as a complete iCalendar document, ready to PUT.
 *
 * `stampedAt` is the DTSTAMP and LAST-MODIFIED the document carries. It is the
 * value the conflict rule compares on the way back in, so the caller passes the
 * moment the edit was made rather than letting this function read a clock.
 */
export function buildIcsDocument(event: WritableEvent, stampedAt: Date): string {
  const zone = normalizeTimeZone(event.timezone)
  const recurring = event.recurrence !== null && event.recurrence.length > 0

  const calendar = new ICAL.Component('vcalendar')
  calendar.addPropertyWithValue('prodid', PRODUCT_ID)
  calendar.addPropertyWithValue('version', '2.0')
  calendar.addPropertyWithValue('calscale', 'GREGORIAN')

  let useZonedTimes = false
  if (recurring && !event.allDay && zone !== 'UTC') {
    const vtimezone = buildVTimezone(zone, localDateTime(event.startAt, zone).year)
    if (vtimezone !== null) {
      calendar.addSubcomponent(vtimezone)
      useZonedTimes = true
    }
    // A zone with no transitions needs no VTIMEZONE and no TZID: its offset is
    // fixed, so a UTC instant repeats at the same wall-clock time anyway.
  }

  const vevent = new ICAL.Component('vevent')
  calendar.addSubcomponent(vevent)
  vevent.addPropertyWithValue('uid', event.icalUid)
  vevent.addPropertyWithValue('dtstamp', utcTime(stampedAt.toISOString()))
  vevent.addPropertyWithValue('last-modified', utcTime(stampedAt.toISOString()))
  vevent.addPropertyWithValue('summary', event.title)
  if (event.description !== null) vevent.addPropertyWithValue('description', event.description)
  if (event.location !== null) vevent.addPropertyWithValue('location', event.location)
  appendTimes(vevent, event, zone, useZonedTimes)

  if (recurring) vevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(event.recurrence!))
  for (const excluded of event.recurrenceExdates ?? []) {
    vevent.addPropertyWithValue('exdate', utcTime(excluded))
  }

  // An override shares its master's UID and is told apart by the occurrence it
  // replaces — the same identity `mapIcalEvent` reconstructs on the way in.
  if (event.originalStartAt !== null) {
    vevent.addPropertyWithValue('recurrence-id', utcTime(event.originalStartAt))
  }

  // Only an explicit cancellation is written; omitting STATUS leaves the
  // server's own default alone rather than asserting CONFIRMED over it.
  if (event.status === 'cancelled') vevent.addPropertyWithValue('status', 'CANCELLED')

  return calendar.toString()
}

/**
 * The resource filename for an event within a collection. Derived from the UID
 * so a retry addresses the same resource and cannot create a second copy —
 * which is what makes a replayed create idempotent at the HTTP layer as well as
 * in the queue.
 */
export function resourceNameFor(icalUid: string): string {
  const safe = icalUid.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120)
  return `${safe.length > 0 ? safe : 'event'}.ics`
}
