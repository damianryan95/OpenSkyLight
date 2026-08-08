import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { expandOccurrences, occurrenceTimes, type MasterEventLike } from '../../src/shared/recurrence/expand'
import {
  buildRRuleString,
  parseRRuleString,
  withUntilInstant,
  withoutEndCap
} from '../../src/shared/recurrence/build'

const CHI = 'America/Chicago'

function master(overrides: Partial<MasterEventLike>): MasterEventLike {
  return {
    id: 'm1',
    startAt: '2026-06-01T14:00:00Z', // 9:00 AM Chicago (CDT, UTC-5)
    endAt: '2026-06-01T15:00:00Z',
    tz: CHI,
    allDay: false,
    rrule: null,
    rdates: null,
    exdates: null,
    ...overrides
  }
}

function localStarts(occs: { start: string }[], zone = CHI): string[] {
  return occs.map((o) => DateTime.fromISO(o.start, { zone: 'utc' }).setZone(zone).toFormat('yyyy-MM-dd HH:mm'))
}

describe('expandOccurrences', () => {
  it('returns a single occurrence for a non-recurring event inside the window', () => {
    const occs = expandOccurrences(master({}), [], '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z')
    expect(occs).toHaveLength(1)
    expect(occs[0].start).toBe('2026-06-01T14:00:00Z')
    expect(occs[0].end).toBe('2026-06-01T15:00:00Z')
  })

  it('excludes non-recurring events outside the window', () => {
    const occs = expandOccurrences(master({}), [], '2026-06-02T00:00:00Z', '2026-06-08T00:00:00Z')
    expect(occs).toHaveLength(0)
  })

  it('accepts Google fixed-offset time zones', () => {
    const occs = expandOccurrences(master({ tz: 'GMT+08:00' }), [], '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z')
    expect(occs).toHaveLength(1)
    expect(occs[0].start).toBe('2026-06-01T14:00:00Z')
  })

  it('expands a daily rule within the window only', () => {
    const m = master({ rrule: 'FREQ=DAILY' })
    const occs = expandOccurrences(m, [], '2026-06-03T00:00:00Z', '2026-06-06T00:00:00Z')
    expect(localStarts(occs)).toEqual(['2026-06-03 09:00', '2026-06-04 09:00', '2026-06-05 09:00'])
  })

  it('respects COUNT', () => {
    const m = master({ rrule: 'FREQ=DAILY;COUNT=3' })
    const occs = expandOccurrences(m, [], '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z')
    expect(occs).toHaveLength(3)
  })

  it('expands weekly BYDAY rules', () => {
    // June 1 2026 is a Monday
    const m = master({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' })
    const occs = expandOccurrences(m, [], '2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z')
    expect(localStarts(occs)).toEqual([
      '2026-06-01 09:00',
      '2026-06-03 09:00',
      '2026-06-08 09:00',
      '2026-06-10 09:00'
    ])
  })

  it('keeps local wall time across the spring-forward DST transition', () => {
    // DST in Chicago: 2026-03-08 02:00 -> 03:00
    const m = master({
      startAt: '2026-03-06T15:00:00Z', // 9:00 AM CST (UTC-6)
      endAt: '2026-03-06T16:00:00Z',
      rrule: 'FREQ=DAILY'
    })
    const occs = expandOccurrences(m, [], '2026-03-06T00:00:00Z', '2026-03-11T00:00:00Z')
    expect(localStarts(occs)).toEqual([
      '2026-03-06 09:00',
      '2026-03-07 09:00',
      '2026-03-08 09:00',
      '2026-03-09 09:00',
      '2026-03-10 09:00'
    ])
    // after the transition the UTC instant shifts by an hour
    expect(occs[0].start).toBe('2026-03-06T15:00:00Z')
    expect(occs[4].start).toBe('2026-03-10T14:00:00Z')
  })

  it('skips exdates', () => {
    const m = master({ rrule: 'FREQ=DAILY', exdates: ['2026-06-02T14:00:00Z'] })
    const occs = expandOccurrences(m, [], '2026-06-01T00:00:00Z', '2026-06-04T00:00:00Z')
    expect(localStarts(occs)).toEqual(['2026-06-01 09:00', '2026-06-03 09:00'])
  })

  it('overlays a moved exception and keeps its original occurrenceStart', () => {
    const m = master({ rrule: 'FREQ=DAILY' })
    const occs = expandOccurrences(
      m,
      [
        {
          id: 'ex1',
          recurringEventId: 'm1',
          originalStartAt: '2026-06-02T14:00:00Z',
          startAt: '2026-06-02T19:00:00Z', // moved to 2 PM
          endAt: '2026-06-02T20:00:00Z',
          status: 'confirmed'
        }
      ],
      '2026-06-01T00:00:00Z',
      '2026-06-04T00:00:00Z'
    )
    expect(localStarts(occs)).toEqual(['2026-06-01 09:00', '2026-06-02 14:00', '2026-06-03 09:00'])
    const moved = occs.find((o) => o.eventId === 'ex1')!
    expect(moved.occurrenceStart).toBe('2026-06-02T14:00:00Z')
    expect(moved.isException).toBe(true)
  })

  it('drops cancelled exceptions', () => {
    const m = master({ rrule: 'FREQ=DAILY' })
    const occs = expandOccurrences(
      m,
      [
        {
          id: 'ex1',
          recurringEventId: 'm1',
          originalStartAt: '2026-06-02T14:00:00Z',
          startAt: '2026-06-02T14:00:00Z',
          endAt: '2026-06-02T15:00:00Z',
          status: 'cancelled'
        }
      ],
      '2026-06-01T00:00:00Z',
      '2026-06-04T00:00:00Z'
    )
    expect(localStarts(occs)).toEqual(['2026-06-01 09:00', '2026-06-03 09:00'])
  })

  it('includes exceptions moved into the window from outside', () => {
    const m = master({ rrule: 'FREQ=DAILY' })
    const occs = expandOccurrences(
      m,
      [
        {
          id: 'ex1',
          recurringEventId: 'm1',
          originalStartAt: '2026-06-20T14:00:00Z', // original far outside window
          startAt: '2026-06-02T16:00:00Z',
          endAt: '2026-06-02T17:00:00Z',
          status: 'confirmed'
        }
      ],
      '2026-06-01T00:00:00Z',
      '2026-06-03T00:00:00Z'
    )
    expect(occs.some((o) => o.eventId === 'ex1')).toBe(true)
  })

  it('handles multi-day all-day events overlapping the window', () => {
    const m = master({
      startAt: '2026-06-01T05:00:00Z', // midnight Chicago
      endAt: '2026-06-04T05:00:00Z', // 3-day event
      allDay: true
    })
    const occs = expandOccurrences(m, [], '2026-06-03T00:00:00Z', '2026-06-10T00:00:00Z')
    expect(occs).toHaveLength(1)
  })

  it('respects UNTIL written by withUntilInstant', () => {
    const capped = withUntilInstant('FREQ=DAILY', '2026-06-04T14:00:00Z')
    const m = master({ rrule: capped })
    const occs = expandOccurrences(m, [], '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z')
    expect(localStarts(occs)).toEqual(['2026-06-01 09:00', '2026-06-02 09:00', '2026-06-03 09:00'])
  })
})

describe('occurrenceTimes', () => {
  it('applies the master duration to an occurrence start', () => {
    const t = occurrenceTimes(master({ rrule: 'FREQ=DAILY' }), '2026-06-05T14:00:00Z')
    expect(t).toEqual({ start: '2026-06-05T14:00:00Z', end: '2026-06-05T15:00:00Z' })
  })
})

describe('rrule build/parse', () => {
  it('round-trips a weekly rule with weekdays', () => {
    const rrule = buildRRuleString({ freq: 'weekly', byWeekdays: [0, 2], interval: 2 }, CHI)
    expect(rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')
    expect(parseRRuleString(rrule, CHI)).toEqual({ freq: 'weekly', interval: 2, byWeekdays: [0, 2] })
  })

  it('round-trips untilDate through UTC', () => {
    const rrule = buildRRuleString({ freq: 'daily', untilDate: '2026-06-30' }, CHI)
    const parsed = parseRRuleString(rrule, CHI)
    expect(parsed?.untilDate).toBe('2026-06-30')
  })

  it('rejects rules we do not model', () => {
    expect(parseRRuleString('FREQ=MONTHLY;BYDAY=2MO', CHI)).toBeNull()
  })

  it('withUntilInstant drops COUNT and prior UNTIL', () => {
    const rrule = withUntilInstant('FREQ=DAILY;COUNT=10;UNTIL=20270101T000000Z', '2026-06-04T14:00:00Z')
    expect(rrule).not.toContain('COUNT')
    expect(rrule).toBe('FREQ=DAILY;UNTIL=20260604T135959Z')
  })

  it('withoutEndCap keeps UNTIL but drops COUNT', () => {
    expect(withoutEndCap('FREQ=WEEKLY;COUNT=5;UNTIL=20270101T000000Z')).toBe('FREQ=WEEKLY;UNTIL=20270101T000000Z')
  })
})
