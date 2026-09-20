import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { useQuery } from '@tanstack/react-query'
import type { HomeTile } from '@shared/types'
import { presetById } from '@shared/rss'
import { agendaRange, dayRange, eachDay } from '@shared/dates'
import { fetchDisplayMedia } from '../../api/browser'
import { ipcInvoke } from '../../api/client'
import {
  useBalances,
  useChoresDay,
  useLists,
  useMeals,
  usePeople,
  useRewards,
  useSettings,
  useWeather
} from '../../api/hooks'
import { useCalendarData } from '../calendar/useCalendarData'
import { useTimers } from '../../stores/timerStore'
import { formatDuration } from '@shared/timer'
import { startAlarm, stopAlarm } from '../../lib/alarm'
import { weatherIcon, weatherWords } from '../weather/WeatherHeader'
import { SLOT_META } from '../meals/Meals'
import { useUi, ZONE } from '../../stores/uiStore'
import { formatTime, initials, textOn } from '../../lib/format'
import { occurrenceColor } from '../../lib/colors'
import { peopleInViewingContext } from '@shared/viewingContext'
import { choreIconSymbol } from '@shared/choreIcons'
import { CheckIcon } from '../../components/icons'
import { useChoreMutations } from '../../api/hooks'

export interface TileProps {
  tile: HomeTile
  /** true when the rendered tile is physically small — show denser content */
  compact: boolean
}

function TileTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 shrink-0 text-xs font-extrabold tracking-wide text-ink-faint uppercase">{children}</div>
  )
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-2 text-center text-sm font-bold text-ink-faint">
      {children}
    </div>
  )
}

function IconVisual({ icon, size = 'text-2xl' }: { icon: string | null; size?: string }) {
  return icon?.startsWith('data:image/svg+xml;base64,')
    ? <img src={icon} alt="" className="h-7 w-7 shrink-0 object-contain" />
    : <span className={`${size} shrink-0 leading-none`} aria-hidden="true">{choreIconSymbol(icon)}</span>
}

const today = (): string => DateTime.now().setZone(ZONE).toISODate()!

export function TodayEventsTile({ compact }: TileProps) {
  const range = dayRange(today(), ZONE)
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const { data: settings } = useSettings()
  const occurrences = byDay.get(today()) ?? []
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>Today</TileTitle>
      {occurrences.length === 0 ? (
        <Placeholder>Nothing on the calendar today</Placeholder>
      ) : (
        <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
          {occurrences.map((occ) => {
            const color = occurrenceColor(occ, peopleById, calendarsById)
            return (
              <div key={occ.key} className="flex items-center gap-2 rounded-lg bg-paper-deep/40 px-2 py-1.5">
                <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-bold ${compact ? 'text-sm' : 'text-base'}`}>{occ.title}</span>
                  <span className="block text-xs font-bold text-ink-faint">
                    {occ.allDay ? 'All day' : formatTime(occ.start, settings?.timeFormat ?? '12h')}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function WeekAgendaTile({ compact }: TileProps) {
  const range = agendaRange(today(), ZONE, 7)
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const { data: settings } = useSettings()
  const days = eachDay(range, ZONE)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>This week</TileTitle>
      <div className="flex min-h-0 flex-col gap-1 overflow-hidden">
        {days.map((day) => {
          const key = day.toISODate()!
          const occs = byDay.get(key) ?? []
          if (occs.length === 0) return null
          return (
            <div key={key} className="flex items-start gap-2">
              <span className="w-12 shrink-0 pt-0.5 text-xs font-extrabold text-ink-faint uppercase">
                {key === today() ? 'Today' : day.toFormat('ccc d')}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {occs.slice(0, compact ? 1 : 3).map((occ) => (
                  <span key={occ.key} className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: occurrenceColor(occ, peopleById, calendarsById) }}
                    />
                    <span className={`truncate font-bold ${compact ? 'text-xs' : 'text-sm'}`}>{occ.title}</span>
                    {!occ.allDay && (
                      <span className="shrink-0 text-xs font-bold text-ink-faint">
                        {formatTime(occ.start, settings?.timeFormat ?? '12h')}
                      </span>
                    )}
                  </span>
                ))}
                {occs.length > (compact ? 1 : 3) && (
                  <span className="text-xs font-extrabold text-ink-faint">+{occs.length - (compact ? 1 : 3)} more</span>
                )}
              </span>
            </div>
          )
        })}
        {[...byDay.values()].every((v) => v.length === 0) && <Placeholder>A quiet week so far</Placeholder>}
      </div>
    </div>
  )
}

export function WeatherTile({ tile, compact }: TileProps) {
  const { data: settings } = useSettings()
  const { data: weather } = useWeather()
  if (!settings?.weather) return <Placeholder>Set a location in Settings → General</Placeholder>
  if (!weather) return <Placeholder>Loading forecast…</Placeholder>
  const Icon = weatherIcon(weather.code, weather.isDay)
  const tiny = tile.h === 1
  const showForecast = tile.w >= 3 && tile.h >= 2 && !compact
  const showDetails = tile.h >= 3 && !compact
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={`flex flex-1 items-center justify-center gap-3 ${tiny ? 'py-0' : 'py-1'}`}>
        <Icon size={tiny ? 28 : compact ? 34 : 44} className="text-ember-deep" />
        <span><span className={`block font-display leading-none ${tiny ? 'text-3xl' : compact ? 'text-4xl' : 'text-5xl'}`}>{weather.temperature}°</span>{!tiny && <span className="block text-sm font-extrabold text-ink-soft">{weather.description}</span>}</span>
      </div>
      {showDetails && <div className="mb-2 flex justify-center gap-3 text-xs font-extrabold text-ink-faint"><span>{weather.description}</span><span>Wind {weather.windSpeed} km/h</span>{weather.daily[0]?.precipProb != null && <span>Rain {weather.daily[0].precipProb}%</span>}</div>}
      {showForecast && (
        <div className="flex shrink-0 justify-around pb-1">
          {weather.daily.slice(0, 4).map((d, i) => {
            const DayIcon = weatherIcon(d.code, true)
            return (
              <span key={d.date} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] font-extrabold text-ink-faint uppercase">
                  {i === 0 ? 'Now' : DateTime.fromISO(d.date).toFormat('ccc')}
                </span>
                <DayIcon size={16} className="text-ember-deep" />
                {!compact && <span className="text-[9px] font-bold text-ink-faint">{weatherWords(d.code)}</span>}
                <span className="text-xs font-bold">{d.high}°</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A wall-friendly family board inspired by paper chore charts: each child
 * owns a coloured column, while time-of-day keeps their routine scannable. */
function ChoreColumnsTile({ compact, title }: Pick<TileProps, 'compact'> & { title: string }) {
  const { data: chores = [] } = useChoresDay(today())
  const { data: people = [] } = usePeople()
  const viewingContext = useUi((s) => s.viewingContext)
  const mutations = useChoreMutations()
  const contextPeople = peopleInViewingContext(viewingContext, people)
  const children = contextPeople.filter((person) => person.role === 'child' && chores.some((chore) => chore.personId === person.id))
  const shown = children.length > 0 ? children : contextPeople.filter((person) => chores.some((chore) => chore.personId === person.id))
  const groups: Array<{ label: string; routine: 'morning' | 'evening' | null }> = [
    { label: 'Morning', routine: 'morning' }, { label: 'Anytime', routine: null }, { label: 'Evening', routine: 'evening' }
  ]
  return <div className="flex h-full flex-col overflow-hidden">
    <TileTitle>{title}</TileTitle>
    {shown.length === 0 ? <Placeholder>No chores today</Placeholder> : <div className="grid min-h-0 flex-1 auto-cols-[minmax(10.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
      {shown.map((person) => {
        const personChores = chores.filter((chore) => chore.personId === person.id)
        const completed = personChores.filter((chore) => chore.completed).length
        return <section key={person.id} className="flex min-h-0 flex-col rounded-[1.7rem] p-2.5" style={{ backgroundColor: `${person.color}1F` }}>
          <header className="mb-2 flex items-center gap-2 px-1">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold" style={{ backgroundColor: person.color, color: textOn(person.color) }}>{initials(person.name)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-display text-xl leading-none">{person.name}</span><span className="mt-1 flex h-5 items-center justify-center rounded-full text-[10px] font-extrabold" style={{ backgroundColor: `${person.color}25`, color: person.color }}>✓ {completed}/{personChores.length}</span></span>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-0.5 pr-1">
            {groups.map((group) => {
              const groupChores = personChores.filter((chore) => chore.routine === group.routine)
              if (groupChores.length === 0) return null
              return <div key={group.label}><p className="mb-1 px-1 text-xs font-extrabold tracking-wide text-ink-soft uppercase">{group.label}</p><div className="space-y-1.5">
                {groupChores.map((chore) => <button key={chore.choreId} type="button" onClick={() => chore.completed ? mutations.uncomplete.mutate({ choreId: chore.choreId, date: today() }) : mutations.complete.mutate({ choreId: chore.choreId, date: today() })} className={`pressable flex min-h-14 w-full items-center gap-2 rounded-2xl px-2.5 text-left ${chore.completed ? 'opacity-60' : ''}`} style={{ backgroundColor: chore.completed ? person.color : `${person.color}16`, color: chore.completed ? textOn(person.color) : undefined }}>
                  <IconVisual icon={chore.icon} />
                  <span className={`min-w-0 flex-1 truncate font-bold ${compact ? 'text-sm' : 'text-base'} ${chore.completed ? 'line-through' : ''}`}>{chore.title}</span>
                  <span className="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xl leading-none font-extrabold" style={{ backgroundColor: chore.completed ? `${textOn(person.color)}24` : `${person.color}24`, color: chore.completed ? textOn(person.color) : person.color }}><span className="text-2xl leading-none" aria-hidden="true">★</span>{chore.starsValue}</span>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: chore.completed ? textOn(person.color) : person.color }}>{chore.completed && <CheckIcon size={15} />}</span>
                </button>)}
              </div></div>
            })}
          </div>
        </section>
      })}
    </div>}
  </div>
}

/** The primary home tile presents every child's chores side by side. */
export function ChoresProgressTile({ compact }: TileProps) {
  return <ChoreColumnsTile compact={compact} title="Chores today" />
}

/** Retained as an optional home-layout tile for existing household layouts. */
export function FamilyChoresTile({ compact }: TileProps) {
  return <ChoreColumnsTile compact={compact} title="Family chores" />
}

export function StarBalancesTile({ compact }: TileProps) {
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const viewingContext = useUi((s) => s.viewingContext)
  const contextPeople = peopleInViewingContext(viewingContext, people)
  const kids = contextPeople.filter((p) => p.role === 'child')
  const shown = kids.length > 0 ? kids : contextPeople
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>Stars</TileTitle>
      {shown.length === 0 ? (
        <Placeholder>Add family members in Settings</Placeholder>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden">
          {shown.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold"
                style={{ backgroundColor: p.color, color: textOn(p.color) }}
              >
                {initials(p.name)}
              </span>
              {!compact && <span className="min-w-0 flex-1 truncate text-base font-bold">{p.name}</span>}
              <span className={`ml-auto flex items-center gap-1 font-display font-extrabold text-ember-deep ${compact ? 'text-2xl' : 'text-3xl'}`}>
                <span className="text-[1.12em] leading-none">★</span>{balances.find((b) => b.personId === p.id)?.balance ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function FamilyRewardsTile({ compact }: TileProps) {
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const { data: rewards = [] } = useRewards()
  const viewingContext = useUi((s) => s.viewingContext)
  const contextPeople = peopleInViewingContext(viewingContext, people)
  const children = contextPeople.filter((person) => person.role === 'child')
  const shown = children.length > 0 ? children : contextPeople
  const activeRewards = rewards.filter((reward) => reward.active)
  return <div className="flex h-full flex-col overflow-hidden"><TileTitle>Family rewards</TileTitle>
    {shown.length === 0 ? <Placeholder>Add children to show rewards</Placeholder> : activeRewards.length === 0 ? <Placeholder>No rewards available yet</Placeholder> : <div className="grid min-h-0 flex-1 auto-cols-[minmax(11rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
      {shown.map((person) => {
        const balance = balances.find((entry) => entry.personId === person.id)?.balance ?? 0
        return <section key={person.id} className="flex min-h-0 flex-col rounded-[1.7rem] p-2.5" style={{ backgroundColor: `${person.color}1F` }}><header className="mb-2 flex items-center gap-2 px-1"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold" style={{ backgroundColor: person.color, color: textOn(person.color) }}>{initials(person.name)}</span><span className="min-w-0 flex-1"><span className="block truncate font-display text-xl leading-none">{person.name}</span><span className="mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ backgroundColor: `${person.color}25`, color: person.color }}>★ {balance}</span></span></header><div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-0.5 pr-1">{activeRewards.map((reward) => { const progress = Math.min(100, Math.round(balance / reward.costStars * 100)); return <div key={reward.id} className="rounded-2xl bg-card p-3 shadow-card"><div className="flex items-center gap-2"><IconVisual icon={reward.icon} /><span className={`min-w-0 flex-1 font-bold ${compact ? 'text-sm' : 'text-base'}`}>{reward.title}</span></div><div className="mt-2 h-5 overflow-hidden rounded-full bg-paper-deep" aria-label={`${balance} of ${reward.costStars} stars`}><div className="flex h-full items-center justify-center text-[10px] font-extrabold" style={{ width: `${Math.max(progress, 18)}%`, backgroundColor: `${person.color}70`, color: textOn(person.color) }}>★ {balance}/{reward.costStars}</div></div></div> })}</div></section>
      })}
    </div>}
  </div>
}

export function ListTile({ tile, compact }: TileProps) {
  const { data: lists = [] } = useLists()
  const list = lists.find((l) => l.id === tile.config?.listId)
  if (!list) return <Placeholder>List not found — re-add this tile</Placeholder>
  const unchecked = list.items.filter((i) => !i.checked)
  const maxItems = compact ? 4 : 8
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-1.5 flex shrink-0 items-center gap-1.5">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: list.color }} />
        <span className="truncate text-xs font-extrabold tracking-wide text-ink-faint uppercase">{list.name}</span>
      </div>
      {unchecked.length === 0 ? (
        <Placeholder>All done!</Placeholder>
      ) : (
        <div className="flex min-h-0 flex-col gap-1 overflow-hidden">
          {unchecked.slice(0, maxItems).map((item) => (
            <span key={item.id} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full border-2" style={{ borderColor: list.color }} />
              <span className={`truncate font-bold ${compact ? 'text-sm' : 'text-base'}`}>{item.text}</span>
            </span>
          ))}
          {unchecked.length > maxItems && (
            <span className="text-xs font-extrabold text-ink-faint">+{unchecked.length - maxItems} more</span>
          )}
        </div>
      )}
    </div>
  )
}

export function MealsTile({ compact }: TileProps) {
  const { data: meals = [] } = useMeals(today(), today())
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>Meals today</TileTitle>
      {meals.length === 0 ? (
        <Placeholder>No meals planned</Placeholder>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-hidden">
          {meals.map((m) => (
            <span key={m.slot} className="flex items-center gap-2">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                style={{ backgroundColor: SLOT_META[m.slot].color }}
              >
                {SLOT_META[m.slot].letter}
              </span>
              <span className={`truncate font-bold ${compact ? 'text-sm' : 'text-base'}`}>{m.text}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function ClockTile({ compact }: TileProps) {
  const { data: settings } = useSettings()
  const [now, setNow] = useState(() => DateTime.now().setZone(ZONE))
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now().setZone(ZONE)), 10_000)
    return () => clearInterval(t)
  }, [])
  const timeFormat = settings?.timeFormat ?? '12h'
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-hidden">
      <span className={`font-display leading-none ${compact ? 'text-4xl' : 'text-5xl'}`}>
        {timeFormat === '24h' ? now.toFormat('HH:mm') : now.toFormat('h:mm')}
      </span>
      <span className="mt-1 text-sm font-bold text-ink-soft">{now.toFormat('ccc, LLL d')}</span>
    </div>
  )
}

export function NewsTile({ tile, compact }: TileProps) {
  const preset = tile.config?.feedId ? presetById(tile.config.feedId) : undefined
  const { data: feed, isError } = useQuery({
    queryKey: ['rss', tile.config?.feedId],
    queryFn: () => ipcInvoke('rss:getFeed', { feedId: tile.config!.feedId! }),
    enabled: !!preset,
    refetchInterval: 15 * 60_000,
    retry: 2
  })
  if (!preset) return <Placeholder>Feed not found — re-add this tile</Placeholder>

  const maxItems = compact ? 3 : Math.max(3, tile.h * 2 - 1)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TileTitle>{preset.label}</TileTitle>
      {isError && !feed ? (
        <Placeholder>Couldn't load headlines — will retry</Placeholder>
      ) : !feed ? (
        <Placeholder>Loading headlines…</Placeholder>
      ) : (
        <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
          {feed.items.slice(0, maxItems).map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ember" />
              <span className="min-w-0 flex-1">
                <span
                  className={`block overflow-hidden font-bold text-ellipsis ${compact ? 'text-xs whitespace-nowrap' : 'line-clamp-2 text-sm'}`}
                >
                  {item.title}
                </span>
                {item.publishedAt && !compact && (
                  <span className="block text-[11px] font-bold text-ink-faint">
                    {DateTime.fromISO(item.publishedAt).toRelative()}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const TIMER_PRESETS_SEC = [60, 180, 300, 600, 900]

export function TimerTile({ compact }: TileProps) {
  const timers = useTimers((s) => s.timers)
  const add = useTimers((s) => s.add)
  const cancel = useTimers((s) => s.cancel)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const anyRinging = timers.some((t) => now >= t.endsAt)
  useEffect(() => {
    if (!anyRinging) return
    startAlarm()
    return () => stopAlarm()
  }, [anyRinging])

  const preset = (sec: number): string => (sec >= 60 ? `${sec / 60}m` : `${sec}s`)
  const singleTimer = timers.length === 1 ? timers[0] : undefined

  return (
    <div className="flex h-full flex-col overflow-hidden [container-type:size]">
      <TileTitle>Timers</TileTitle>

      {!singleTimer && <div className="mb-2 flex shrink-0 flex-wrap gap-1.5">
        {TIMER_PRESETS_SEC.map((sec) => (
          <button
            key={sec}
            type="button"
            aria-label={`Start a ${preset(sec)} timer`}
            onClick={() => add(sec)}
            className="pressable rounded-lg bg-paper-deep px-2.5 py-1 text-sm font-extrabold text-ink-soft"
          >
            {preset(sec)}
          </button>
        ))}
      </div>}

      {timers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-sm font-bold text-ink-faint">
          Tap a preset, or say “set a timer for 5 minutes”
        </div>
      ) : singleTimer ? (() => {
        const remaining = Math.max(0, Math.ceil((singleTimer.endsAt - now) / 1000)); const ringing = remaining <= 0
        const pct = Math.min(100, Math.max(0, (1 - remaining / singleTimer.durationSec) * 100))
        return <div className={`flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl px-3 text-center ${ringing ? 'animate-pulse bg-ember text-white' : 'bg-paper-deep/60'}`}>
          {singleTimer.label && <span className={`mb-2 max-w-full truncate text-sm font-extrabold ${ringing ? 'text-white/90' : 'text-ink-faint'}`}>{singleTimer.label}</span>}
          <span className="font-display tabular-nums leading-[0.78] text-[clamp(3rem,58cqh,11rem)]">{ringing ? 'Done!' : formatDuration(remaining)}</span>
          {!ringing && <span className="mt-4 block h-2 w-4/5 overflow-hidden rounded-full bg-paper-deep"><span className="block h-full rounded-full bg-ember transition-all" style={{ width: `${pct}%` }} /></span>}
          <button type="button" aria-label={ringing ? `Dismiss ${singleTimer.label ?? 'timer'}` : `Cancel ${singleTimer.label ?? 'timer'}`} onClick={() => cancel(singleTimer.id)} className={`pressable mt-4 rounded-full px-5 py-2 text-sm font-extrabold ${ringing ? 'bg-white/25 text-white' : 'bg-card text-ink-soft'}`}>{ringing ? 'Dismiss' : 'Cancel'}</button>
        </div>
      })() : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {timers.map((t) => {
            const remaining = Math.max(0, Math.ceil((t.endsAt - now) / 1000))
            const ringing = remaining <= 0
            const pct = Math.min(100, Math.max(0, (1 - remaining / t.durationSec) * 100))
            return (
              <div
                key={t.id}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 ${
                  ringing ? 'animate-pulse bg-ember text-white' : 'bg-paper-deep/60'
                }`}
              >
                <span className="min-w-0 flex-1">
                  {t.label && (
                    <span className={`block truncate text-xs font-extrabold ${ringing ? 'text-white/90' : 'text-ink-faint'}`}>
                      {t.label}
                    </span>
                  )}
                  <span className={`block font-display tabular-nums ${compact ? 'text-xl' : 'text-2xl'} leading-none`}>
                    {ringing ? 'Done!' : formatDuration(remaining)}
                  </span>
                  {!ringing && !compact && (
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-paper-deep">
                      <span className="block h-full rounded-full bg-ember transition-all" style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={ringing ? `Dismiss ${t.label ?? 'timer'}` : `Cancel ${t.label ?? 'timer'}`}
                  onClick={() => cancel(t.id)}
                  className={`pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                    ringing ? 'bg-white/25 text-white' : 'text-ink-faint hover:bg-paper-deep'
                  }`}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function PhotoTile({ tile }: TileProps) {
  const { data: photos = [] } = useQuery({
    queryKey: ['screensaverPhotos'],
    queryFn: () => ipcInvoke('screensaver:listPhotos', undefined),
    staleTime: 60_000
  })
  const [index, setIndex] = useState(0)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (photos.length < 2) return
    const t = setInterval(() => setIndex((i) => (i + 1) % photos.length), 30_000)
    return () => clearInterval(t)
  }, [photos.length])

  const current = photos.length === 0 ? null : photos[(index + tile.id.length) % photos.length]
  useEffect(() => {
    if (current === null) { setSrc(null); return }
    const controller = new AbortController()
    let objectUrl: string | null = null
    void fetchDisplayMedia(current, controller.signal)
      .then((blob) => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl) } })
      .catch(() => setSrc(null))
    return () => { controller.abort(); if (objectUrl !== null) URL.revokeObjectURL(objectUrl) }
  }, [current])

  if (photos.length === 0) return <Placeholder>Add family photos from the parent phone, in Planning → Photos</Placeholder>
  if (src === null) return <Placeholder>Loading photos…</Placeholder>
  return (
    <div className="-m-4 h-[calc(100%+2rem)] overflow-hidden">
      <img key={src} src={src} alt="" className="h-full w-full object-cover" style={{ animation: 'fade-in 1s ease backwards' }} />
    </div>
  )
}
