import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { usePeople, useSettings } from '../../api/hooks'
import { useUi, ZONE } from '../../stores/uiStore'
import { IconButton } from '../../components/ui'
import { ViewSwitcher } from './ViewSwitcher'
import { ChevronLeftIcon, ChevronRightIcon, GearIcon } from '../../components/icons'
import { WeatherButton } from '../weather/WeatherHeader'
import { initials, textOn } from '../../lib/format'
import { inViewingContext } from '@shared/viewingContext'
import type { CalendarViewKind } from '@shared/types'
import { isDisplayClient } from '../../lib/clientMode'
import { LockControl } from '../calendar/EditingControls'

const VIEW_OPTIONS: readonly { value: CalendarViewKind; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'chores', label: 'Chores' },
  { value: 'lists', label: 'Lists' }
]

function useNow(): DateTime {
  const [now, setNow] = useState(() => DateTime.now().setZone(ZONE))
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now().setZone(ZONE)), 20_000)
    return () => clearInterval(t)
  }, [])
  return now
}

// Full month names where one month is named; abbreviated where two are, or
// where "From" already takes the room. Portrait width is what decides this.
function periodLabel(view: CalendarViewKind, focusedDate: string, weekStartsOn: 0 | 1): string {
  const d = DateTime.fromISO(focusedDate, { zone: ZONE })
  if (view === 'home' || view === 'lists') return ''
  if (view === 'day' || view === 'chores') return d.toFormat('LLLL d')
  if (view === 'month') return d.toFormat('LLLL yyyy')
  if (view === 'agenda') return `From ${d.toFormat('LLL d')}`
  const target = weekStartsOn === 0 ? 7 : 1
  let start = d
  while (start.weekday !== target) start = start.minus({ days: 1 })
  const end = start.plus({ days: 6 })
  return start.month === end.month
    ? `${start.toFormat('LLLL d')} – ${end.toFormat('d')}`
    : `${start.toFormat('LLL d')} – ${end.toFormat('LLL d')}`
}

/**
 * The longest strings `periodLabel` can produce for a view. "September" is the
 * longest month name and "Sept" its longest abbreviation; digits are tabular,
 * so any two-digit day measures the same.
 */
function widestPeriodLabels(view: CalendarViewKind): string[] {
  if (view === 'day' || view === 'chores') return ['September 30']
  if (view === 'month') return ['September 2026']
  if (view === 'agenda') return ['From Sept 30']
  if (view === 'week') return ['September 20 – 26', 'Sept 27 – Oct 30']
  return []
}

export function Header() {
  const now = useNow()
  const { data: settings } = useSettings()
  const { data: people = [] } = usePeople()
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const focusedDate = useUi((s) => s.focusedDate)
  const step = useUi((s) => s.step)
  const goToday = useUi((s) => s.goToday)
  const viewingContext = useUi((s) => s.viewingContext)
  const selectFamily = useUi((s) => s.selectFamily)
  const selectPerson = useUi((s) => s.selectPerson)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const weekStartsOn = settings?.weekStartsOn ?? 0
  const timeFormat = settings?.timeFormat ?? '12h'
  const display = isDisplayClient()
  return (
    // A portrait panel has no width for clock, avatars, period picker, seven
    // views and padlock in one row, and the views were what fell off - leaving
    // no way back to Home. The view switcher folds what does not fit under
    // "More"; wrapping is the last resort for a row too narrow for even that,
    // and a wrapped row keeps its controls at the right, beside the padlock.
    <header className="flex flex-wrap items-center justify-end gap-2 px-4 pt-5 pb-4 min-[1500px]:gap-3 min-[1500px]:px-5">
      {/* Today + a big clock (the header is the only clock since the home
          screen dropped its clock tile); scales down so everything still
          fits on 1280-wide displays */}
      <button type="button" onClick={goToday} className="pressable flex shrink-0 items-center gap-3 text-left min-[1500px]:gap-4">
        <div>
          <div className="font-display text-[2.05rem] leading-none font-semibold tracking-tight min-[1500px]:text-[2.6rem]">
            {now.toFormat('cccc')}
          </div>
          <div className="mt-1 text-base font-bold text-ink-soft min-[1500px]:text-lg">{now.toFormat('LLLL d')}</div>
        </div>
        <div className="w-px self-stretch bg-ink-faint/30" />
        <div className="font-display text-[2.05rem] leading-none font-semibold tracking-tight tabular-nums min-[1500px]:text-[3.1rem]">
          {timeFormat === '24h' ? (
            now.toFormat('HH:mm')
          ) : (
            <>
              {now.toFormat('h:mm')}
              <span className="ml-1 text-lg font-bold text-ink-soft min-[1500px]:ml-1.5 min-[1500px]:text-2xl">
                {now.toFormat('a').toLowerCase()}
              </span>
            </>
          )}
        </div>
      </button>

      <WeatherButton />

      {/* Takes what the switcher does not want, so the switcher stays beside the padlock. */}
      <div className="flex-1" />

      {/* Viewing context is one explicit choice, never a collection of hidden people. */}
      {people.length > 0 && (
        <div className={`flex shrink-0 items-center ${people.length >= 4 ? '-space-x-2' : 'gap-1.5'}`}>
          <button
            type="button"
            aria-label="Show Family view"
            aria-pressed={viewingContext === 'family'}
            title="Family"
            onClick={selectFamily}
            className={`pressable z-10 min-h-12 rounded-full px-3 text-sm font-extrabold ring-2 ring-paper transition-all ${
              viewingContext === 'family' ? 'bg-ink text-paper shadow-card' : 'bg-paper-deep text-ink-soft'
            }`}
          >
            Family
          </button>
          {people.map((p) => {
            const selected = inViewingContext(viewingContext, p.id)
            return (
              <button
                key={p.id}
                type="button"
                aria-label={`Show ${p.name}'s view`}
                aria-pressed={selected}
                title={p.name}
                onClick={() => selectPerson(p.id)}
                className={`pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ring-2 ring-paper transition-all ${
                  selected ? 'z-10 scale-110 shadow-card ring-ember' : 'opacity-70'
                }`}
                style={{ backgroundColor: p.color, color: textOn(p.color) }}
              >
                {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials(p.name)}
              </button>
            )
          })}
        </div>
      )}

      {/* period nav (removed from layout where it isn't meaningful — space matters here) */}
      {view !== 'lists' && view !== 'home' && (
        <div className="flex shrink-0 items-center gap-1 rounded-2xl bg-paper-deep/70 p-1">
          <IconButton label="Previous" onClick={() => step(-1)}>
            <ChevronLeftIcon />
          </IconButton>
          <button
            type="button"
            onClick={goToday}
            className="pressable grid min-h-12 rounded-xl px-2 py-2 text-center text-base font-extrabold text-ink tabular-nums"
          >
            {/* The box is as wide as the widest label this view can ever show,
                so stepping between months does not resize it and shove the
                view switcher about. The widest candidates sit invisibly in
                the same grid cell as the live label. */}
            {widestPeriodLabels(view).map((ghost) => (
              <span key={ghost} aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-nowrap">{ghost}</span>
            ))}
            <span className="col-start-1 row-start-1 whitespace-nowrap">{periodLabel(view, focusedDate, weekStartsOn)}</span>
          </button>
          <IconButton label="Next" onClick={() => step(1)}>
            <ChevronRightIcon />
          </IconButton>
        </div>
      )}

      <ViewSwitcher
        value={view}
        onChange={setView}
        options={VIEW_OPTIONS}
      />

      {/* A display shows its lock where a desktop shows settings: the one place
          on every view where a parent can see editing is off, and turn it on. */}
      {display ? <LockControl /> : <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
        <GearIcon size={26} />
      </IconButton>}
    </header>
  )
}
