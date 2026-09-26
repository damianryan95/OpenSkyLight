import { useState } from 'react'
import { DateTime } from 'luxon'
import type { DayChoreDto, PersonDto } from '@shared/types'
import { useBalances, useChoreMutations, useChoresDay, usePeople } from '../../api/hooks'
import { useUi, ZONE } from '../../stores/uiStore'
import { initials, isToday, textOn } from '../../lib/format'
import { peopleInViewingContext } from '@shared/viewingContext'
import { CheckIcon, MoonIcon, SunIcon } from '../../components/icons'
import { BigButton } from '../../components/ui'
import { RewardsDialog } from './RewardsDialog'
import { isDisplayClient } from '../../lib/clientMode'

function StarBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sun-soft px-2.5 py-1 text-sm font-extrabold text-ember-deep">
      <span aria-hidden>★</span>
      {count}
    </span>
  )
}

function ChoreRow({
  chore,
  person,
  date,
  canCheck
}: {
  chore: DayChoreDto
  person: PersonDto
  date: string
  canCheck: boolean
}) {
  const mutations = useChoreMutations()
  const toggle = (): void => {
    if (!canCheck) return
    if (chore.completed) mutations.uncomplete.mutate({ choreId: chore.choreId, date })
    else mutations.complete.mutate({ choreId: chore.choreId, date })
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!canCheck}
      className={`pressable flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-card disabled:opacity-60 ${
        chore.completed ? 'opacity-75' : ''
      }`}
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] transition-colors"
        style={{
          borderColor: person.color,
          backgroundColor: chore.completed ? person.color : 'transparent'
        }}
      >
        {chore.completed && <CheckIcon size={24} className="animate-pop" style={{ color: textOn(person.color) }} />}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-lg font-bold ${chore.completed ? 'text-ink-faint line-through' : ''}`}
      >
        {chore.title}
      </span>
      {chore.starsValue > 0 && <StarBadge count={chore.starsValue} />}
    </button>
  )
}

function PersonColumn({ person, chores, date, canCheck }: { person: PersonDto; chores: DayChoreDto[]; date: string; canCheck: boolean }) {
  const { data: balances = [] } = useBalances()
  const balance = balances.find((b) => b.personId === person.id)?.balance ?? 0
  const groups: { key: string; label: string | null; Icon: typeof SunIcon | null; items: DayChoreDto[] }[] = [
    { key: 'morning', label: 'Morning', Icon: SunIcon, items: chores.filter((c) => c.routine === 'morning') },
    { key: 'anytime', label: null, Icon: null, items: chores.filter((c) => c.routine === null) },
    { key: 'evening', label: 'Evening', Icon: MoonIcon, items: chores.filter((c) => c.routine === 'evening') }
  ].filter((g) => g.items.length > 0)
  const doneCount = chores.filter((c) => c.completed).length

  return (
    <div className="flex min-h-0 w-80 shrink-0 flex-col rounded-card bg-paper-deep/40 p-3">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full text-base font-extrabold"
          style={{ backgroundColor: person.color, color: textOn(person.color) }}
        >
          {initials(person.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-bold">{person.name}</div>
          <div className="text-sm font-bold text-ink-faint">
            {doneCount}/{chores.length} done
          </div>
        </div>
        <StarBadge count={balance} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-2">
            {g.label && (
              <div className="mt-1 flex items-center gap-1.5 px-1 text-sm font-extrabold tracking-wide text-ink-faint uppercase">
                {g.Icon && <g.Icon size={15} />}
                {g.label}
              </div>
            )}
            {g.items.map((c) => (
              <ChoreRow key={c.choreId} chore={c} person={person} date={date} canCheck={canCheck} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChoresView() {
  const focusedDate = useUi((s) => s.focusedDate)
  const viewingContext = useUi((s) => s.viewingContext)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const { data: people = [] } = usePeople()
  const { data: chores = [] } = useChoresDay(focusedDate)
  const [rewardsOpen, setRewardsOpen] = useState(false)
  const day = DateTime.fromISO(focusedDate, { zone: ZONE })
  const display = isDisplayClient()
  // A display may only change the current household day. Parent corrections
  // remain available in the dedicated administration app.
  const canCheck = display
    ? isToday(focusedDate)
    : focusedDate <= DateTime.now().setZone(ZONE).toISODate()!

  const byPerson = new Map<string, DayChoreDto[]>()
  for (const c of chores) {
    const arr = byPerson.get(c.personId) ?? []
    arr.push(c)
    byPerson.set(c.personId, arr)
  }
  const columns = peopleInViewingContext(viewingContext, people).filter((p) => byPerson.has(p.id))

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="animate-rise mb-4 flex items-end gap-4">
        <div className="flex-1">
          <div className="font-display text-4xl">
            {isToday(focusedDate) ? "Today's chores" : `Chores · ${day.toFormat('cccc, LLL d')}`}
          </div>
        </div>
        <BigButton variant="ghost" onClick={() => setRewardsOpen(true)}>
          ★ Rewards
        </BigButton>
        {/* Opens the chores and rewards editor. On a display the settings sheet
            asks for the parent PIN first, or opens straight in if the header
            lock is already open. */}
        <BigButton variant="ghost" onClick={() => setSettingsOpen(true)}>
          Manage
        </BigButton>
      </div>

      {columns.length === 0 ? (
        <div className="animate-rise mt-16 flex flex-col items-center gap-4 text-center">
          <div className="font-display text-3xl text-ink-faint">No chores for this day</div>
          <p className="max-w-md text-base font-semibold text-ink-soft">
            Parents can set up routines and chores in Settings → Chores.
          </p>
          <BigButton variant="ghost" onClick={() => setSettingsOpen(true)}>
            Set up chores
          </BigButton>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 justify-center gap-4 overflow-x-auto">
          {columns.map((person, i) => (
            <div key={person.id} className="animate-rise flex min-h-0" style={{ animationDelay: `${i * 60}ms` }}>
              <PersonColumn person={person} chores={byPerson.get(person.id)!} date={focusedDate} canCheck={canCheck} />
            </div>
          ))}
        </div>
      )}

      <RewardsDialog open={rewardsOpen} onClose={() => setRewardsOpen(false)} />
    </div>
  )
}
