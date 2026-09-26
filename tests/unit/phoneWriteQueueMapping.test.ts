import { describe, expect, it } from 'vitest'
import type { PendingEventWriteDto } from '../../src/shared/api/contract'
import { allDayMillisForDevice, toDeviceRecurrence, toDraft } from '../../src/companion/src/api/phoneWriteQueue'
import { buildRRuleString } from '../../src/shared/recurrence/build'

/**
 * Translating the board's RRULE into the structured rule the calendar plugin
 * takes. Worth its own test because the two number weekdays differently, and
 * getting that wrong writes a household's swimming lesson onto the wrong day of
 * every week in a way no type would catch.
 */
describe('RRULE to the phone plugin’s recurrence rule', () => {
  it('maps a weekly rule, shifting weekdays from the board’s numbering to the plugin’s', () => {
    // The board numbers from 0 = Monday; the plugin from 1 = Monday.
    expect(toDeviceRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR', 'Europe/London')).toEqual({
      frequency: 'weekly', byWeekDay: [1, 3, 5]
    })
    expect(toDeviceRecurrence('FREQ=WEEKLY;BYDAY=SU', 'Europe/London')).toEqual({
      frequency: 'weekly', byWeekDay: [7]
    })
  })

  it('carries an interval only when it is not the default', () => {
    expect(toDeviceRecurrence('FREQ=DAILY', 'Europe/London')).toEqual({ frequency: 'daily' })
    expect(toDeviceRecurrence('FREQ=WEEKLY;INTERVAL=2', 'Europe/London')).toEqual({ frequency: 'weekly', interval: 2 })
  })

  it('carries an end date, and a count when there is no end date', () => {
    expect(toDeviceRecurrence('FREQ=MONTHLY;UNTIL=20261231T235959Z', 'Europe/London'))
      .toEqual({ frequency: 'monthly', end: Date.parse('2026-12-31T23:59:59Z') })
    expect(toDeviceRecurrence('FREQ=YEARLY;COUNT=5', 'Europe/London')).toEqual({ frequency: 'yearly', count: 5 })
  })

  it('round-trips whatever the editor can build', () => {
    const rrule = buildRRuleString({ freq: 'weekly', interval: 2, byWeekdays: [0, 4], untilDate: '2026-12-01' }, 'Europe/London')
    expect(toDeviceRecurrence(rrule, 'Europe/London')).toMatchObject({
      frequency: 'weekly', interval: 2, byWeekDay: [1, 5]
    })
  })

  it('gives up rather than guessing on a rule it cannot express', () => {
    expect(toDeviceRecurrence(null, 'Europe/London')).toBeNull()
    // A positional BYDAY ("the second Monday") is not modelled by either side.
    expect(toDeviceRecurrence('FREQ=MONTHLY;BYDAY=2MO', 'Europe/London')).toBeNull()
  })
})

describe('an all-day board event handed to the phone', () => {
  it('lands on midnight UTC of its calendar date, as Android expects', () => {
    // The board's all-day 26 Sep in London is 23:00Z on the 25th; Android wants 00:00Z on the 26th.
    expect(allDayMillisForDevice('2026-09-25T23:00:00.000Z', 'Europe/London')).toBe(Date.UTC(2026, 8, 26))
    expect(allDayMillisForDevice('2026-09-26T04:00:00.000Z', 'America/New_York')).toBe(Date.UTC(2026, 8, 26))
  })

  it('converts both ends of the draft and never hands Android a zero-length all-day event', () => {
    const write = {
      id: 'w1', sourceCalendarId: 'cal', op: 'create', mirrorKey: null, etag: null,
      event: {
        id: 'e1', title: 'Sports day', description: null, location: null,
        startAt: '2026-09-25T23:00:00.000Z', endAt: '2026-09-26T23:00:00.000Z',
        timezone: 'Europe/London', allDay: true, recurrence: null, originalStartAt: null
      }
    } as unknown as PendingEventWriteDto
    const draft = toDraft(write)!
    expect(draft.allDay).toBe(true)
    expect(draft.startAt).toBe(Date.UTC(2026, 8, 26))
    expect(draft.endAt).toBe(Date.UTC(2026, 8, 27))
    const zero = toDraft({ ...write, event: { ...write.event, endAt: write.event.startAt } } as PendingEventWriteDto)!
    expect(zero.endAt).toBe(Date.UTC(2026, 8, 27))
  })

  it('leaves a timed event exactly where the board put it', () => {
    const write = {
      id: 'w2', sourceCalendarId: 'cal', op: 'create', mirrorKey: null, etag: null,
      event: {
        id: 'e2', title: 'Dentist', description: null, location: null,
        startAt: '2026-09-26T09:30:00.000Z', endAt: '2026-09-26T10:00:00.000Z',
        timezone: 'Europe/London', allDay: false, recurrence: null, originalStartAt: null
      }
    } as unknown as PendingEventWriteDto
    const draft = toDraft(write)!
    expect(draft.startAt).toBe(Date.parse('2026-09-26T09:30:00.000Z'))
    expect(draft.endAt).toBe(Date.parse('2026-09-26T10:00:00.000Z'))
  })
})
