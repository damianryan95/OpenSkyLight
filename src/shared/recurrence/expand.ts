import { RRule } from 'rrule'
import { DateTime } from 'luxon'
import { isoUtc } from '../dates'
import { normalizeTimeZone } from '../timezone'

/**
 * Pure recurrence expansion.
 *
 * rrule operates on "floating" dates (JS Dates whose UTC fields actually hold local wall-clock
 * values). All conversions between real instants and floating dates happen here, via Luxon,
 * using the event's IANA zone — so DST is handled by Luxon, never by rrule.
 */

export interface MasterEventLike {
  id: string
  /** UTC ISO instant */
  startAt: string
  endAt: string
  /** IANA zone the recurrence pattern lives in */
  tz: string
  allDay: boolean
  rrule: string | null
  /** Extra occurrence starts, UTC ISO */
  rdates: string[] | null
  /** Skipped occurrence starts, UTC ISO */
  exdates: string[] | null
}

export interface ExceptionLike {
  id: string
  recurringEventId: string
  /** The (original) occurrence start this row overrides, UTC ISO */
  originalStartAt: string
  startAt: string
  endAt: string
  status: 'confirmed' | 'cancelled'
}

export interface ExpandedOccurrence {
  masterId: string
  /** Exception row id when overridden, else master id */
  eventId: string
  /** Original occurrence start (stable key for this/following edits), UTC ISO */
  occurrenceStart: string
  start: string
  end: string
  isException: boolean
}

function toFloating(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second))
}

function fromFloating(d: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds()
    },
    { zone }
  )
}

function norm(iso: string): string {
  return isoUtc(DateTime.fromISO(iso, { zone: 'utc' }))
}

interface Duration {
  allDayDays: number | null
  millis: number
}

function eventDuration(master: MasterEventLike): Duration {
  const zone = normalizeTimeZone(master.tz)
  const start = DateTime.fromISO(master.startAt, { zone: 'utc' }).setZone(zone)
  const end = DateTime.fromISO(master.endAt, { zone: 'utc' }).setZone(zone)
  if (master.allDay) {
    return { allDayDays: Math.max(1, Math.round(end.diff(start, 'days').days)), millis: 0 }
  }
  return { allDayDays: null, millis: end.toMillis() - start.toMillis() }
}

function occurrenceEnd(occStart: DateTime, dur: Duration): DateTime {
  return dur.allDayDays !== null ? occStart.plus({ days: dur.allDayDays }) : occStart.plus({ milliseconds: dur.millis })
}

/** Start/end instants for the (unmodified) occurrence beginning at `occurrenceStartIso`. */
export function occurrenceTimes(
  master: MasterEventLike,
  occurrenceStartIso: string
): { start: string; end: string } {
  const dur = eventDuration(master)
  const occStart = DateTime.fromISO(occurrenceStartIso, { zone: 'utc' }).setZone(normalizeTimeZone(master.tz))
  return { start: isoUtc(occStart), end: isoUtc(occurrenceEnd(occStart, dur)) }
}

/**
 * Expand a master event (recurring or not) into concrete occurrences overlapping
 * [windowStartIso, windowEndIso), overlaying exception rows.
 */
export function expandOccurrences(
  master: MasterEventLike,
  exceptions: ExceptionLike[],
  windowStartIso: string,
  windowEndIso: string
): ExpandedOccurrence[] {
  const zone = normalizeTimeZone(master.tz)
  const dur = eventDuration(master)
  const windowStart = DateTime.fromISO(windowStartIso, { zone: 'utc' })
  const windowEnd = DateTime.fromISO(windowEndIso, { zone: 'utc' })

  const exdates = new Set((master.exdates ?? []).map(norm))
  const byOriginal = new Map(exceptions.map((ex) => [norm(ex.originalStartAt), ex]))

  // 1. Collect candidate occurrence starts (real instants)
  const startsMs = new Map<number, DateTime>()
  const addStart = (dt: DateTime) => {
    if (!startsMs.has(dt.toMillis())) startsMs.set(dt.toMillis(), dt)
  }

  if (master.rrule) {
    const seriesStart = DateTime.fromISO(master.startAt, { zone: 'utc' }).setZone(zone)
    let parsed
    try {
      parsed = RRule.parseString(master.rrule)
    } catch {
      parsed = null
    }
    if (parsed) {
      parsed.dtstart = toFloating(seriesStart)
      if (parsed.until) {
        // UNTIL is a real UTC instant; move it into the event zone, then make it floating
        const u = DateTime.fromJSDate(parsed.until, { zone: 'utc' }).setZone(zone)
        parsed.until = toFloating(u)
      }
      const rule = new RRule(parsed)
      // Expand a slightly wider window so occurrences that *overlap* the window are found
      const pad = dur.allDayDays !== null ? { days: dur.allDayDays } : { milliseconds: dur.millis }
      const floatStart = toFloating(windowStart.setZone(zone).minus(pad))
      const floatEnd = toFloating(windowEnd.setZone(zone))
      for (const d of rule.between(floatStart, floatEnd, true)) {
        addStart(fromFloating(d, zone))
      }
    }
  } else {
    addStart(DateTime.fromISO(master.startAt, { zone: 'utc' }).setZone(zone))
  }
  for (const r of master.rdates ?? []) {
    addStart(DateTime.fromISO(norm(r), { zone: 'utc' }).setZone(zone))
  }

  // 2. Build occurrences, applying exdates and exception overrides
  const out: ExpandedOccurrence[] = []
  const usedExceptions = new Set<string>()
  for (const occStart of [...startsMs.values()].sort((a, b) => a.toMillis() - b.toMillis())) {
    const occStartIso = isoUtc(occStart)
    if (exdates.has(occStartIso)) continue

    const ex = byOriginal.get(occStartIso)
    if (ex) {
      usedExceptions.add(ex.id)
      if (ex.status === 'cancelled') continue
      const exStart = DateTime.fromISO(ex.startAt, { zone: 'utc' })
      const exEnd = DateTime.fromISO(ex.endAt, { zone: 'utc' })
      if (exStart < windowEnd && exEnd > windowStart) {
        out.push({
          masterId: master.id,
          eventId: ex.id,
          occurrenceStart: occStartIso,
          start: isoUtc(exStart),
          end: isoUtc(exEnd),
          isException: true
        })
      }
      continue
    }

    const occEnd = occurrenceEnd(occStart, dur)
    if (occStart.toUTC() < windowEnd && occEnd.toUTC() > windowStart) {
      out.push({
        masterId: master.id,
        eventId: master.id,
        occurrenceStart: occStartIso,
        start: occStartIso,
        end: isoUtc(occEnd),
        isException: false
      })
    }
  }

  // 3. Exceptions moved INTO the window from an occurrence outside it
  for (const ex of exceptions) {
    if (usedExceptions.has(ex.id) || ex.status === 'cancelled') continue
    if (exdates.has(norm(ex.originalStartAt))) continue
    const exStart = DateTime.fromISO(ex.startAt, { zone: 'utc' })
    const exEnd = DateTime.fromISO(ex.endAt, { zone: 'utc' })
    if (exStart < windowEnd && exEnd > windowStart) {
      out.push({
        masterId: master.id,
        eventId: ex.id,
        occurrenceStart: norm(ex.originalStartAt),
        start: isoUtc(exStart),
        end: isoUtc(exEnd),
        isException: true
      })
    }
  }

  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  return out
}
