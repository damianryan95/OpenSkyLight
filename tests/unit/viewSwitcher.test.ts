import { describe, expect, it } from 'vitest'
import { planViews } from '../../src/renderer/src/features/shell/ViewSwitcher'

/**
 * Which views the header shows and which fold under "More", given real widths.
 * The rule is pure so it can be pinned without a layout engine; the portrait
 * check drives the rendered result against the real kiosk.
 */
const options = [
  { value: 'home', label: 'Home' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }, { value: 'chores', label: 'Chores' }, { value: 'lists', label: 'Lists' }
] as const
const widths = [70, 60, 70, 80, 90, 85, 65] // 520 in all
const more = 90

describe('planning which views fit', () => {
  it('shows every view and no menu when there is room', () => {
    expect(planViews(options, 'day', widths, more, 600, 8)).toEqual({ visible: options.map((o) => o.value), hidden: [] })
  })

  it('folds the views that do not fit under More, keeping the leading ones', () => {
    // 8 + 70 + 60 + 70 + 90 = 298 fits in 300; adding Month (80) would not.
    expect(planViews(options, 'day', widths, more, 300, 8)).toEqual({
      visible: ['home', 'day', 'week'],
      hidden: ['month', 'agenda', 'chores', 'lists']
    })
  })

  it('always keeps the current view visible, taking the last slot', () => {
    // A parent on Agenda must be able to see they are on Agenda.
    expect(planViews(options, 'agenda', widths, more, 300, 8)).toEqual({
      visible: ['home', 'day', 'agenda'],
      hidden: ['week', 'month', 'chores', 'lists']
    })
  })

  it('never shows fewer than one view plus More, even when nothing fits', () => {
    expect(planViews(options, 'chores', widths, more, 50, 8)).toEqual({
      visible: ['chores'],
      hidden: ['home', 'day', 'week', 'month', 'agenda', 'lists']
    })
  })

  it('prefers no menu over a menu when the difference is exactly the More button', () => {
    // All seven fit exactly (8 + 520 = 528): no More, even though six plus More would also fit.
    expect(planViews(options, 'home', widths, more, 528, 8).hidden).toEqual([])
  })
})
