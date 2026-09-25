import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { usePeople, useSettings } from '../../api/hooks'
import { useUi, ZONE } from '../../stores/uiStore'
import { SegmentedControl, IconButton } from '../../components/ui'
import { ChevronLeftIcon, ChevronRightIcon, GearIcon } from '../../components/icons'
import { WeatherButton } from '../weather/WeatherHeader'
import { initials, textOn } from '../../lib/format'
import { inViewingContext } from '@shared/viewingContext'
import type { CalendarViewKind } from '@shared/types'
import { isDisplayClient } from '../../lib/clientMode'
import { LockControl } from '../calendar/EditingControls'

function useNow(): DateTime {
  const [now, setNow] = useState(() => DateTime.now().setZone(ZONE))
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now().setZone(ZONE)), 20_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function periodLabel(view: CalendarViewKind, focusedDate: string, weekStartsOn: 0 | 1): string {
  const d = DateTime.fromISO(focusedDate, { zone: ZONE })
  if (view === 'home' || view === 'lists') return ''
  if (view === 'day' || view === 'chores') return d.toFormat('LLL d')
  if (view === 'month') return d.toFormat('LLLL yyyy')
  if (view === 'agenda') return `From ${d.toFormat('LLL d')}`
  const target = weekStartsOn === 0 ? 7 : 1
  let start = d
  while (start.weekday !== target) start = start.minus({ days: 1 })
  const end = start.plus({ days: 6 })
  return start.month === end.month
    ? `${start.toFormat('LLL d')} – ${end.toFormat('d')}`
    : `${start.toFormat('LLL d')} – ${end.toFormat('LLL d')}`
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
    <header className="flex items-center gap-2 px-4 pt-5 pb-4 min-[1500px]:gap-3 min-[1500px]:px-5">
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
            className="pressable min-h-12 min-w-16 rounded-xl px-2 py-2 text-center text-base font-extrabold text-ink min-[1500px]:min-w-24"
          >
            {periodLabel(view, focusedDate, weekStartsOn)}
          </button>
          <IconButton label="Next" onClick={() => step(1)}>
            <ChevronRightIcon />
          </IconButton>
        </div>
      )}

      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'home', label: 'Home' },
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'agenda', label: 'Agenda' },
          { value: 'chores', label: 'Chores' },
          { value: 'lists', label: 'Lists' }
        ]}
      />

      {/* A display shows its lock where a desktop shows settings: the one place
          on every view where a parent can see editing is off, and turn it on. */}
      {display ? <LockControl /> : <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
        <GearIcon size={26} />
      </IconButton>}
    </header>
  )
}
