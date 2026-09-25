import { describe, expect, it } from 'vitest'
import { toDeviceRecurrence } from '../../src/companion/src/api/phoneWriteQueue'
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
