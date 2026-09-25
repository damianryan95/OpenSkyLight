import { useState } from 'react'
import { DateTime } from 'luxon'
import { eachDay } from '@shared/dates'
import { useSettings } from '../../api/hooks'
import { ZONE } from '../../stores/uiStore'
import { occurrenceColor } from '../../lib/colors'
import { isToday } from '../../lib/format'
import { EventCard } from './EventCard'
import { useCalendarData, useViewRange } from './useCalendarData'
import { useCalendarEditing } from './useEventEditor'
import { MealsDialog, MealStrip, useMealsForRange } from '../meals/Meals'

export function WeekView() {
  const range = useViewRange()
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const { data: settings } = useSettings()
  const timeFormat = settings?.timeFormat ?? '12h'
  const days = eachDay(range, ZONE)
  const mealsByDay = useMealsForRange(range)
  const [mealDate, setMealDate] = useState<string | null>(null)
  const { unlocked, editOccurrence, createOn } = useCalendarEditing()

  return (
    <div className="grid h-full grid-cols-7 gap-3 px-6 pb-6">
      {days.map((day, i) => {
        const key = day.toISODate()!
        const occurrences = byDay.get(key) ?? []
        const today = isToday(key)
        return (
          <div
            key={key}
            className={`animate-rise flex min-h-0 flex-col rounded-card p-2 ${
              today ? 'bg-sun-soft shadow-card ring-2 ring-sun' : 'bg-paper-deep/40'
            }`}
            style={{ animationDelay: `${i * 45}ms` }}
          >
            <div
              className={`mb-2 flex items-baseline gap-2 rounded-xl px-2 py-1 ${unlocked ? 'pressable' : ''}`}
              {...(unlocked ? { onClick: () => createOn(key), role: 'button', tabIndex: 0 } : {})}
            >
              <span className={`text-sm font-extrabold uppercase ${today ? 'text-ember-deep' : 'text-ink-faint'}`}>{day.toFormat('ccc')}</span>
              <span className={`font-display text-3xl ${today ? 'flex h-11 w-11 items-center justify-center rounded-full bg-ember leading-none text-white' : 'text-ink'}`}>{day.day}</span>
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
            >
              {occurrences.map((occ) => (
                <EventCard
                  key={occ.key}
                  occ={occ}
                  color={occurrenceColor(occ, peopleById, calendarsById)}
                  timeFormat={timeFormat}
                  peopleById={peopleById}
                  onSelect={editOccurrence}
                />
              ))}
              {occurrences.length === 0 && (
                <div className="flex-1" />
              )}
            </div>
            <div className="mt-2">
              <MealStrip date={key} meals={mealsByDay.get(key) ?? []} onOpen={setMealDate} />
            </div>
          </div>
        )
      })}
      <MealsDialog date={mealDate} meals={mealDate ? (mealsByDay.get(mealDate) ?? []) : []} onClose={() => setMealDate(null)} />
    </div>
  )
}

export function dayLabel(dateIso: string): string {
  return DateTime.fromISO(dateIso, { zone: ZONE }).toFormat('cccc, LLLL d')
}
