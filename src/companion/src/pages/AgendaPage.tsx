import { useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import type { OccurrenceDto } from '@shared/types'
import type { EventDraftDto } from '@shared/api/contract'
import { buildRRuleString, describeRecurrence } from '@shared/recurrence/build'
import { useEventMutations, useOccurrences, usePeople } from '../api/hooks'
import { Card, EmptyNote, GhostButton, PersonAvatar, PrimaryButton, TextInput } from '../components/ui'

/**
 * The week's calendar, and editing it from the parent's phone (`N06`).
 *
 * What this page deliberately does not say is where an event will end up. Tagging
 * somebody whose calendar is writable sends it to that calendar; everything else
 * keeps it on the board, and that is the ordinary outcome rather than a degraded
 * one. A "not synced" badge would tell a household something had gone wrong when
 * nothing had.
 */

type RepeatChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ZONE = DateTime.now().zoneName ?? 'UTC'

export function AgendaPage() {
  const start = DateTime.now().startOf('day')
  const end = start.plus({ days: 7 }).endOf('day')
  const { data: occurrences = [], isPending } = useOccurrences(start.toISO()!, end.toISO()!)
  const { data: people = [] } = usePeople()
  const { create, update, remove } = useEventMutations()
  const [composing, setComposing] = useState<string | null>(null)
  const [editing, setEditing] = useState<OccurrenceDto | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const byDay = new Map<string, OccurrenceDto[]>()
  for (const occ of occurrences) {
    const day = DateTime.fromISO(occ.start).toISODate()!
    byDay.set(day, [...(byDay.get(day) ?? []), occ])
  }
  const days = [...byDay.keys()].sort()

  function close(): void {
    setComposing(null)
    setEditing(null)
    setFailure(null)
  }

  async function save(draft: EventDraftDto, scope: 'series' | 'occurrence'): Promise<void> {
    setFailure(null)
    try {
      if (editing === null) await create.mutateAsync(draft)
      else if (scope === 'occurrence' && editing.isRecurring) {
        await update.mutateAsync({ id: editing.masterId, patch: draft, scope: 'occurrence', occurrenceStart: editing.occurrenceStart })
      } else {
        await update.mutateAsync({ id: editing.masterId, patch: draft })
      }
      close()
    } catch {
      setFailure('That change could not be saved. Check you are on the home network, then try again.')
    }
  }

  async function destroy(scope: 'series' | 'occurrence'): Promise<void> {
    if (editing === null) return
    setFailure(null)
    try {
      await remove.mutateAsync(scope === 'occurrence' && editing.isRecurring
        ? { id: editing.masterId, scope: 'occurrence', occurrenceStart: editing.occurrenceStart }
        : { id: editing.masterId })
      close()
    } catch {
      setFailure('That event could not be deleted. Check you are on the home network, then try again.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {failure !== null && <p role="alert" className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800">{failure}</p>}
      {(composing !== null || editing !== null) && (
        <EventForm
          key={editing?.key ?? composing ?? 'new'}
          occurrence={editing}
          date={composing ?? DateTime.fromISO(editing!.start).toISODate()!}
          people={people}
          busy={create.isPending || update.isPending || remove.isPending}
          onCancel={close}
          onSave={save}
          onDelete={destroy}
        />
      )}
      {composing === null && editing === null && (
        <GhostButton onClick={() => setComposing(start.toISODate()!)}>Add an event</GhostButton>
      )}

      {isPending && <EmptyNote>Loading…</EmptyNote>}
      {!isPending && days.length === 0 && <EmptyNote>Nothing on the calendar this week.</EmptyNote>}
      {days.map((day) => {
        const d = DateTime.fromISO(day)
        const isToday = day === start.toISODate()
        return (
          <Card key={day}>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">
                {isToday ? 'Today' : d.toFormat('cccc')}
                <span className="ml-2 text-base font-bold text-ink-faint">{d.toFormat('LLL d')}</span>
              </h2>
              <GhostButton onClick={() => { setEditing(null); setComposing(day) }}>Add</GhostButton>
            </div>
            {byDay
              .get(day)!
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((occ) => (
                <button
                  key={occ.key}
                  type="button"
                  disabled={occ.readOnly}
                  onClick={() => { setComposing(null); setEditing(occ) }}
                  className="flex w-full items-center gap-3 border-b border-line/60 py-2 text-left last:border-0 disabled:opacity-100"
                >
                  <span className="w-16 shrink-0 text-sm font-extrabold text-ink-faint">
                    {occ.allDay ? 'All day' : DateTime.fromISO(occ.start).toFormat('h:mm a').toLowerCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">{occ.title}</span>
                  {/* A subscription feed cannot be written to at all, so the row
                      says why it will not open rather than failing on save. */}
                  {occ.readOnly && <span className="shrink-0 text-xs font-extrabold text-ink-faint">From a feed</span>}
                  <span className="flex shrink-0 -space-x-1.5">
                    {occ.personIds
                      .map((id) => people.find((p) => p.id === id))
                      .filter((p) => p !== undefined)
                      .map((p) => (
                        <PersonAvatar key={p.id} name={p.name} color={p.color} size="sm" />
                      ))}
                  </span>
                </button>
              ))}
          </Card>
        )
      })}
    </div>
  )
}

function EventForm({
  occurrence,
  date: initialDate,
  people,
  busy,
  onCancel,
  onSave,
  onDelete
}: {
  occurrence: OccurrenceDto | null
  date: string
  people: { id: string; name: string; color: string; avatarUrl: string | null }[]
  busy: boolean
  onCancel: () => void
  onSave: (draft: EventDraftDto, scope: 'series' | 'occurrence') => void
  onDelete: (scope: 'series' | 'occurrence') => void
}) {
  const localStart = occurrence === null ? null : DateTime.fromISO(occurrence.start)
  const localEnd = occurrence === null ? null : DateTime.fromISO(occurrence.end)
  const [title, setTitle] = useState(occurrence?.title ?? '')
  const [location, setLocation] = useState(occurrence?.location ?? '')
  const [allDay, setAllDay] = useState(occurrence?.allDay ?? false)
  const [date, setDate] = useState(localStart?.toISODate() ?? initialDate)
  const [startTime, setStartTime] = useState(localStart?.toFormat('HH:mm') ?? '09:00')
  const [endTime, setEndTime] = useState(localEnd?.toFormat('HH:mm') ?? '10:00')
  const [personId, setPersonId] = useState<string | null>(occurrence?.personIds[0] ?? null)
  const [repeat, setRepeat] = useState<RepeatChoice>('none')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [untilDate, setUntilDate] = useState('')
  // Asked before a series is changed, not undone afterwards.
  const [scopePrompt, setScopePrompt] = useState<'save' | 'delete' | null>(null)

  const isSeries = occurrence?.isRecurring === true
  const rule = repeat === 'none' ? null : {
    freq: repeat,
    ...(repeat === 'weekly' && weekdays.length > 0 ? { byWeekdays: [...weekdays].sort((a, b) => a - b) } : {}),
    ...(untilDate === '' ? {} : { untilDate })
  }

  function draft(): EventDraftDto {
    const base = DateTime.fromISO(date, { zone: ZONE }).startOf('day')
    const startAt = allDay ? base : DateTime.fromISO(`${date}T${startTime}`, { zone: ZONE })
    const endAt = allDay ? base : DateTime.fromISO(`${date}T${endTime}`, { zone: ZONE })
    return {
      title: title.trim(),
      description: null,
      location: location.trim() === '' ? null : location.trim(),
      startAt: startAt.toUTC().toISO({ suppressMilliseconds: true })!,
      endAt: endAt.toUTC().toISO({ suppressMilliseconds: true })!,
      timezone: ZONE,
      allDay,
      recurrence: rule === null ? null : buildRRuleString(rule, ZONE),
      personId
    }
  }

  const valid = title.trim() !== '' && (allDay || endTime >= startTime)

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (!valid) return
    // A one-off has no scope to choose, so it saves straight away.
    if (isSeries) setScopePrompt('save')
    else onSave(draft(), 'series')
  }

  if (scopePrompt !== null) {
    return (
      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-xl font-semibold">
            {scopePrompt === 'save' ? 'Save which events?' : 'Delete which events?'}
          </h3>
          <PrimaryButton
            onClick={() => (scopePrompt === 'save' ? onSave(draft(), 'occurrence') : onDelete('occurrence'))}
            disabled={busy}
          >
            Just this one
          </PrimaryButton>
          <GhostButton onClick={() => (scopePrompt === 'save' ? onSave(draft(), 'series') : onDelete('series'))}>
            Every event in the series
          </GhostButton>
          <GhostButton onClick={() => setScopePrompt(null)}>Back</GhostButton>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <h3 className="font-display text-xl font-semibold">{occurrence === null ? 'Add event' : 'Edit event'}</h3>
        <TextInput value={title} onChange={setTitle} placeholder="Event name" autoFocus />
        <TextInput value={location} onChange={setLocation} placeholder="Where (optional)" />

        <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} className="h-5 w-5" />
          All day
        </label>

        <label className="text-sm font-bold">
          Date
          <input
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"
            type="date" value={date} onChange={(event) => setDate(event.target.value)}
          />
        </label>

        {!allDay && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-bold">
              Starts
              <input
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"
                type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label className="text-sm font-bold">
              Ends
              <input
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"
                type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-extrabold">Who is it for?</legend>
          <div className="grid gap-2">
            <button
              type="button" aria-pressed={personId === null} onClick={() => setPersonId(null)}
              className={`flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 text-left font-extrabold ${personId === null ? 'border-ember bg-ember/10' : 'border-line bg-paper'}`}
            >
              Everyone
            </button>
            {people.map((person) => (
              <button
                key={person.id} type="button" aria-pressed={personId === person.id}
                onClick={() => setPersonId(person.id)}
                className={`flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 text-left font-extrabold ${personId === person.id ? 'border-ember bg-ember/10' : 'border-line bg-paper'}`}
              >
                <PersonAvatar name={person.name} color={person.color} avatarUrl={person.avatarUrl} />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="text-sm font-bold">
          Repeats
          <select
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"
            value={repeat} onChange={(event) => setRepeat(event.target.value as RepeatChoice)}
          >
            <option value="none">Never</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>

        {repeat === 'weekly' && (
          <fieldset>
            <legend className="mb-2 text-sm font-extrabold">On these days</legend>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((label, index) => (
                <button
                  key={label} type="button" aria-pressed={weekdays.includes(index)}
                  onClick={() => setWeekdays(weekdays.includes(index) ? weekdays.filter((day) => day !== index) : [...weekdays, index])}
                  className={`min-h-11 rounded-lg text-xs font-extrabold ${weekdays.includes(index) ? 'bg-ember text-white' : 'bg-paper-deep text-ink-soft'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {repeat !== 'none' && (
          <>
            <label className="text-sm font-bold">
              Until (optional)
              <input
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold"
                type="date" value={untilDate} onChange={(event) => setUntilDate(event.target.value)}
              />
            </label>
            <p className="text-sm font-semibold text-ink-faint">{describeRecurrence(rule)}</p>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <PrimaryButton type="submit" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save event'}</PrimaryButton>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
          {occurrence !== null && (
            <GhostButton onClick={() => (isSeries ? setScopePrompt('delete') : onDelete('series'))}>Delete</GhostButton>
          )}
        </div>
      </form>
    </Card>
  )
}
