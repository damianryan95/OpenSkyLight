import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import type { OccurrenceDto, PersonDto, RecurrenceInput } from '@shared/types'
import { buildRRuleString, describeRecurrence, parseRRuleString } from '@shared/recurrence/build'
import { useEventDetail, useEventMutations } from '../../api/hooks'
import { DateField, TimeField } from '../../components/DateTimePickers'
import { OskInput } from '../../components/Osk'
import { BigButton, FieldLabel, SegmentedControl, Sheet, Toggle } from '../../components/ui'
import { ZONE } from '../../stores/uiStore'

/**
 * Creating and editing a calendar event on the wall display (`N15`).
 *
 * Two things about this screen are product decisions rather than styling:
 *
 * - **It never explains where the event will sync to.** Tagging a person whose
 *   calendar is writable sends it there; everything else keeps it on the board.
 *   Staying local is the ordinary outcome, so surfacing it as a state — a badge, a
 *   warning, a "not synced" note — would tell a household something is wrong when
 *   nothing is.
 * - **Editing one date of a series asks first.** Silently rewriting a repeating
 *   event from a screen on a wall is the mistake this ticket names explicitly, and
 *   the choice is offered before the change, not undone after it.
 */

export interface EventEditorTarget {
  /** An existing occurrence to edit, or null to create. */
  occurrence: OccurrenceDto | null
  /** The day a create was started from, so a new event lands where the parent tapped. */
  date: string
}

type RecurrenceChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
type SeriesScope = 'occurrence' | 'series'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function minutesOf(instant: string): number {
  const local = DateTime.fromISO(instant, { zone: 'utc' }).setZone(ZONE)
  return local.hour * 60 + local.minute
}

function instantFrom(date: string, minutes: number, allDay: boolean): string {
  const base = DateTime.fromISO(date, { zone: ZONE }).startOf('day')
  const local = allDay ? base : base.plus({ minutes })
  return local.toUTC().toISO({ suppressMilliseconds: true })!
}

export function EventEditor({
  target,
  people,
  weekStartsOn,
  timeFormat,
  onClose
}: {
  target: EventEditorTarget
  people: PersonDto[]
  weekStartsOn: 0 | 1
  timeFormat: '12h' | '24h'
  onClose: () => void
}) {
  const editingId = target.occurrence?.eventId ?? null
  const { data: detail } = useEventDetail(editingId)
  const { create, update, remove } = useEventMutations()

  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [date, setDate] = useState(target.date)
  const [startMinutes, setStartMinutes] = useState(9 * 60)
  const [endMinutes, setEndMinutes] = useState(10 * 60)
  const [personId, setPersonId] = useState<string | null>(null)
  const [repeat, setRepeat] = useState<RecurrenceChoice>('none')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [untilDate, setUntilDate] = useState<string | null>(null)
  const [scopePrompt, setScopePrompt] = useState<'save' | 'delete' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const occurrence = target.occurrence
  const isSeries = occurrence?.isRecurring === true

  // Pre-fill from the event the parent tapped. The occurrence carries what the
  // board renders; the detail read carries the rule and the tag, which nothing
  // displays and an editor cannot invent.
  useEffect(() => {
    if (occurrence === null) {
      setDate(target.date)
      return
    }
    const start = DateTime.fromISO(occurrence.start, { zone: 'utc' }).setZone(ZONE)
    setTitle(occurrence.title)
    setLocation(occurrence.location ?? '')
    setAllDay(occurrence.allDay)
    setDate(start.toISODate()!)
    setStartMinutes(minutesOf(occurrence.start))
    setEndMinutes(minutesOf(occurrence.end))
  }, [occurrence, target.date])

  useEffect(() => {
    if (detail === undefined || detail === null) return
    setPersonId(detail.personIds[0] ?? null)
    const rule: RecurrenceInput | null = detail.recurrence ?? (detail.rrule === null ? null : parseRRuleString(detail.rrule, detail.tz))
    setRepeat(rule?.freq ?? 'none')
    setWeekdays(rule?.byWeekdays ?? [])
    setUntilDate(rule?.untilDate ?? null)
  }, [detail])

  const recurrenceRule = useMemo<RecurrenceInput | null>(() => {
    if (repeat === 'none') return null
    const rule: RecurrenceInput = { freq: repeat }
    if (repeat === 'weekly' && weekdays.length > 0) rule.byWeekdays = [...weekdays].sort((a, b) => a - b)
    if (untilDate !== null) rule.untilDate = untilDate
    return rule
  }, [repeat, weekdays, untilDate])

  const readOnly = occurrence?.readOnly === true
  const saving = create.isPending || update.isPending || remove.isPending
  const canSave = title.trim().length > 0 && !readOnly && !saving && (allDay || endMinutes >= startMinutes)

  function draft() {
    return {
      title: title.trim(),
      description: detail?.description ?? null,
      location: location.trim() === '' ? null : location.trim(),
      startAt: instantFrom(date, startMinutes, allDay),
      // An all-day event covers the day it is on; the server treats the end as
      // exclusive when it writes the iCalendar document.
      endAt: instantFrom(date, allDay ? 0 : endMinutes, allDay),
      timezone: ZONE,
      allDay,
      recurrence: recurrenceRule === null ? null : buildRRuleString(recurrenceRule, ZONE),
      personId
    }
  }

  /** A written message, never a raw server error: a wall display is read by
   * children, and the remote text can carry things it should not show. */
  function explain(): string {
    return 'That change could not be saved. Try again, or use the phone app if it keeps happening.'
  }

  async function save(scope: SeriesScope): Promise<void> {
    setFailure(null)
    try {
      if (occurrence === null) {
        await create.mutateAsync(draft())
      } else if (scope === 'occurrence' && isSeries) {
        await update.mutateAsync({
          id: occurrence.masterId, patch: draft(), scope: 'occurrence', occurrenceStart: occurrence.occurrenceStart
        })
      } else {
        await update.mutateAsync({ id: occurrence.masterId, patch: draft() })
      }
      onClose()
    } catch {
      setFailure(explain())
    }
  }

  async function destroy(scope: SeriesScope): Promise<void> {
    if (occurrence === null) return
    setFailure(null)
    try {
      await remove.mutateAsync(scope === 'occurrence' && isSeries
        ? { id: occurrence.masterId, scope: 'occurrence', occurrenceStart: occurrence.occurrenceStart }
        : { id: occurrence.masterId })
      onClose()
    } catch {
      setFailure(explain())
    }
  }

  function requestSave(): void {
    if (isSeries) { setScopePrompt('save'); return }
    void save('series')
  }

  function requestDelete(): void {
    if (isSeries) { setScopePrompt('delete'); return }
    void destroy('series')
  }

  return (
    <Sheet open onClose={onClose} title={occurrence === null ? 'New event' : 'Edit event'} wide>
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Title</FieldLabel>
          <OskInput value={title} onChange={setTitle} placeholder="e.g. Dentist" autoFocus={occurrence === null} />
        </div>

        <div className="flex items-center justify-between">
          <FieldLabel>All day</FieldLabel>
          <Toggle checked={allDay} onChange={setAllDay} label="All day" />
        </div>

        <DateField label="Date" value={date} onChange={setDate} weekStartsOn={weekStartsOn} />

        {!allDay && (
          <div className="grid grid-cols-2 gap-4">
            <TimeField
              label="Starts"
              minutes={startMinutes}
              timeFormat={timeFormat}
              onChange={(minutes) => {
                setStartMinutes(minutes)
                // Keep the duration rather than letting the end fall behind the
                // start, which the server would refuse after the parent had
                // already moved on.
                if (minutes > endMinutes) setEndMinutes(Math.min(minutes + 60, 24 * 60 - 15))
              }}
            />
            <TimeField label="Ends" minutes={endMinutes} timeFormat={timeFormat} onChange={setEndMinutes} />
          </div>
        )}

        <div>
          <FieldLabel>Location</FieldLabel>
          <OskInput value={location} onChange={setLocation} placeholder="Optional" />
        </div>

        <div>
          <FieldLabel>Who is it for?</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <BigButton variant={personId === null ? 'primary' : 'ghost'} onClick={() => setPersonId(null)}>Everyone</BigButton>
            {people.map((person) => (
              <BigButton
                key={person.id}
                variant={personId === person.id ? 'primary' : 'ghost'}
                onClick={() => setPersonId(person.id)}
              >
                {person.name}
              </BigButton>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>Repeats</FieldLabel>
          <SegmentedControl
            value={repeat}
            onChange={(value) => setRepeat(value)}
            options={[
              { value: 'none', label: 'Never' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' }
            ]}
          />
        </div>

        {repeat === 'weekly' && (
          <div>
            <FieldLabel>On these days</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map((label, index) => (
                <BigButton
                  key={label}
                  variant={weekdays.includes(index) ? 'primary' : 'ghost'}
                  onClick={() => setWeekdays(weekdays.includes(index)
                    ? weekdays.filter((day) => day !== index)
                    : [...weekdays, index])}
                >
                  {label}
                </BigButton>
              ))}
            </div>
          </div>
        )}

        {repeat !== 'none' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <FieldLabel>Stops on a date</FieldLabel>
              <Toggle
                checked={untilDate !== null}
                label="Stops on a date"
                onChange={(on) => setUntilDate(on ? DateTime.fromISO(date, { zone: ZONE }).plus({ months: 3 }).toISODate()! : null)}
              />
            </div>
            {untilDate !== null && (
              <DateField label="Until" value={untilDate} onChange={setUntilDate} weekStartsOn={weekStartsOn} />
            )}
            <p className="text-lg font-semibold text-ink-faint">{describeRecurrence(recurrenceRule)}</p>
          </div>
        )}

        {readOnly && (
          <p className="text-lg font-semibold text-ink-faint">
            This event comes from a calendar that cannot be changed here.
          </p>
        )}
        {failure !== null && <p className="text-lg font-semibold text-ember">{failure}</p>}

        <div className="mt-2 flex flex-wrap gap-3">
          <BigButton variant="primary" onClick={requestSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </BigButton>
          <BigButton variant="ghost" onClick={onClose}>Cancel</BigButton>
          {occurrence !== null && !readOnly && (
            <BigButton variant="danger" onClick={requestDelete} disabled={saving}>Delete</BigButton>
          )}
        </div>
      </div>

      {/* Asked before the change, because a series rewritten by accident cannot
          be put back from a wall display. */}
      {scopePrompt !== null && (
        <Sheet open onClose={() => setScopePrompt(null)} title={scopePrompt === 'save' ? 'Save which events?' : 'Delete which events?'}>
          <div className="flex flex-col gap-3">
            <BigButton
              variant="primary"
              onClick={() => {
                setScopePrompt(null)
                void (scopePrompt === 'save' ? save('occurrence') : destroy('occurrence'))
              }}
            >
              Just this one
            </BigButton>
            <BigButton
              variant="ghost"
              onClick={() => {
                setScopePrompt(null)
                void (scopePrompt === 'save' ? save('series') : destroy('series'))
              }}
            >
              Every event in the series
            </BigButton>
            <BigButton variant="ghost" onClick={() => setScopePrompt(null)}>Cancel</BigButton>
          </div>
        </Sheet>
      )}
    </Sheet>
  )
}
