import { useState } from 'react'
import { DateTime } from 'luxon'
import type { ChoreDto, ChoreRoutine, PersonDto } from '@shared/types'
import { choreIconSymbol } from '@shared/choreIcons'
import { useBalances, useChoreMutations, useChores, useChoresDay, usePeople } from '../api/hooks'
import { Card, CheckCircle, EmptyNote, GhostButton, PersonAvatar, PrimaryButton, TextInput } from '../components/ui'

type Repeat = 'once' | 'daily' | 'weekly'

export function ChoresPage() {
  const today = DateTime.now().toISODate()!
  const { data: dayChores = [], isPending } = useChoresDay(today)
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const mutations = useChoreMutations()
  const [showForm, setShowForm] = useState(false)
  const [showManage, setShowManage] = useState(false)

  const balanceOf = (personId: string): number => balances.find((b) => b.personId === personId)?.balance ?? 0

  return (
    <div className="flex flex-col gap-4">
      {isPending && <EmptyNote>Loading…</EmptyNote>}
      {!isPending && dayChores.length === 0 && <EmptyNote>No chores today.</EmptyNote>}

      {people
        .filter((p) => dayChores.some((c) => c.personId === p.id))
        .map((person) => {
          const theirs = dayChores.filter((c) => c.personId === person.id)
          const done = theirs.filter((c) => c.completed).length
          return (
            <Card key={person.id}>
              <div className="mb-1 flex items-center gap-2.5">
                <PersonAvatar name={person.name} color={person.color} />
                <h2 className="flex-1 truncate font-display text-xl font-semibold">{person.name}</h2>
                <span className="text-sm font-extrabold text-ink-faint">
                  {done}/{theirs.length} · ★ {balanceOf(person.id)}
                </span>
              </div>
              {theirs.map((chore) => (
                <div key={chore.choreId} className="flex items-center border-b border-line/60 last:border-0">
                  <span className="mr-2 text-xl" aria-hidden="true">{choreIconSymbol(chore.icon)}</span>
                  <CheckCircle
                    checked={chore.completed}
                    color={person.color}
                    onTap={() =>
                      chore.completed
                        ? mutations.uncomplete.mutate({ choreId: chore.choreId, date: today })
                        : mutations.complete.mutate({ choreId: chore.choreId, date: today })
                    }
                    label={`${chore.completed ? 'Uncheck' : 'Check off'} ${chore.title}`}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate py-2 text-base font-semibold ${chore.completed ? 'text-ink-faint line-through' : ''}`}
                  >
                    {chore.title}
                  </span>
                  {chore.starsValue > 0 && (
                    <span className="shrink-0 text-sm font-extrabold text-ink-faint">★ {chore.starsValue}</span>
                  )}
                </div>
              ))}
            </Card>
          )
        })}

      {showForm ? (
        <NewChoreForm
          people={people}
          onCreate={(input) => {
            mutations.create.mutate(input)
            setShowForm(false)
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <GhostButton onClick={() => setShowForm(true)}>+ New chore</GhostButton>
      )}

      <GhostButton onClick={() => setShowManage((v) => !v)}>
        {showManage ? 'Hide all chores' : 'Manage all chores'}
      </GhostButton>
      {showManage && <ManageChores people={people} />}
    </div>
  )
}

function NewChoreForm({
  people,
  onCreate,
  onCancel
}: {
  people: PersonDto[]
  onCreate: (input: {
    title: string
    personId: string
    starsValue: number
    recurrence: { freq: 'daily' | 'weekly'; byWeekdays?: number[] } | null
    anchorDate: string
    routine: ChoreRoutine
  }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [personId, setPersonId] = useState(people[0]?.id ?? '')
  const [stars, setStars] = useState(1)
  const [repeat, setRepeat] = useState<Repeat>('daily')
  const today = DateTime.now()

  const submit = (): void => {
    if (!title.trim() || !personId) return
    onCreate({
      title: title.trim(),
      personId,
      starsValue: stars,
      // rrule convention: 0 = Monday … 6 = Sunday; luxon weekday is 1–7
      recurrence:
        repeat === 'once'
          ? null
          : repeat === 'daily'
            ? { freq: 'daily' }
            : { freq: 'weekly', byWeekdays: [today.weekday - 1] },
      anchorDate: today.toISODate()!,
      routine: null
    })
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <TextInput value={title} onChange={setTitle} placeholder="Chore (e.g. Feed the dog)" autoFocus />
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPersonId(p.id)}
              className={`pressable flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-extrabold ${
                personId === p.id ? 'bg-ember text-white' : 'bg-paper-deep text-ink-soft'
              }`}
            >
              <PersonAvatar name={p.name} color={p.color} size="sm" />
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-xl bg-paper-deep">
            {(['once', 'daily', 'weekly'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRepeat(r)}
                className={`min-h-11 px-3 text-sm font-extrabold ${repeat === r ? 'bg-card shadow-card' : 'text-ink-soft'}`}
              >
                {r === 'once' ? 'Just today' : r === 'daily' ? 'Every day' : `${today.toFormat('cccc')}s`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Fewer stars"
              onClick={() => setStars((s) => Math.max(0, s - 1))}
              className="pressable h-11 w-11 rounded-xl bg-paper-deep text-lg font-extrabold"
            >
              −
            </button>
            <span className="min-w-10 text-center text-base font-extrabold">★ {stars}</span>
            <button
              type="button"
              aria-label="More stars"
              onClick={() => setStars((s) => Math.min(99, s + 1))}
              className="pressable h-11 w-11 rounded-xl bg-paper-deep text-lg font-extrabold"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={!title.trim() || !personId}>
            Add chore
          </PrimaryButton>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </form>
    </Card>
  )
}

function ManageChores({ people }: { people: PersonDto[] }) {
  const { data: chores = [] } = useChores()
  if (chores.length === 0) return <EmptyNote>No chores defined yet.</EmptyNote>
  return (
    <div className="flex flex-col gap-3">
      {chores.map((chore) => (
        <ManageChoreRow key={chore.id} chore={chore} person={people.find((p) => p.id === chore.personId)} />
      ))}
    </div>
  )
}

function ManageChoreRow({ chore, person }: { chore: ChoreDto; person: PersonDto | undefined }) {
  const mutations = useChoreMutations()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chore.title)

  return (
    <Card className={chore.active ? '' : 'opacity-60'}>
      <div className="flex items-center gap-2.5">
        {person && <PersonAvatar name={person.name} color={person.color} size="sm" />}
        {editing ? (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (title.trim()) mutations.update.mutate({ id: chore.id, title: title.trim() })
              setEditing(false)
            }}
          >
            <TextInput value={title} onChange={setTitle} autoFocus />
            <PrimaryButton type="submit">Save</PrimaryButton>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="pressable min-w-0 flex-1 truncate py-1 text-left text-base font-bold"
          >
            {chore.title}
            <span className="ml-2 text-sm font-extrabold text-ink-faint">★ {chore.starsValue}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => mutations.update.mutate({ id: chore.id, active: !chore.active })}
          className="pressable shrink-0 rounded-lg bg-paper-deep px-2.5 py-1.5 text-sm font-extrabold text-ink-soft"
        >
          {chore.active ? 'Pause' : 'Resume'}
        </button>
      </div>
    </Card>
  )
}
