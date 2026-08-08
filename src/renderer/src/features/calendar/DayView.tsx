import { useState } from 'react'
import { useSettings } from '../../api/hooks'
import { useUi, ZONE } from '../../stores/uiStore'
import { occurrenceColor } from '../../lib/colors'
import { EventCard } from './EventCard'
import { useCalendarData, useViewRange } from './useCalendarData'
import { DateTime } from 'luxon'
import { MealsDialog, MealStrip, useMealsForRange } from '../meals/Meals'

export function DayView() {
  const range = useViewRange()
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const { data: settings } = useSettings()
  const focusedDate = useUi((s) => s.focusedDate)
  const timeFormat = settings?.timeFormat ?? '12h'
  const occurrences = byDay.get(focusedDate) ?? []
  const day = DateTime.fromISO(focusedDate, { zone: ZONE })
  const mealsByDay = useMealsForRange(range)
  const [mealDate, setMealDate] = useState<string | null>(null)

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-6 pb-28">
      <div className="animate-rise mb-4 flex items-end justify-between">
        <div>
          <div className="font-display text-5xl">{day.toFormat('cccc')}</div>
          <div className="mt-1 text-xl font-bold text-ink-soft">{day.toFormat('LLLL d, yyyy')}</div>
        </div>
      </div>
      <div className="animate-rise mb-4">
        <MealStrip date={focusedDate} meals={mealsByDay.get(focusedDate) ?? []} onOpen={setMealDate} compact={false} />
      </div>
      <MealsDialog
        date={mealDate}
        meals={mealDate ? (mealsByDay.get(mealDate) ?? []) : []}
        onClose={() => setMealDate(null)}
      />
      <div className="flex flex-col gap-3">
        {occurrences.map((occ, i) => (
          <div key={occ.key} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
            <EventCard
              occ={occ}
              color={occurrenceColor(occ, peopleById, calendarsById)}
              timeFormat={timeFormat}
              peopleById={peopleById}
              size="lg"
            />
          </div>
        ))}
        {occurrences.length === 0 && (
          <div className="animate-rise mt-16 flex flex-col items-center gap-5 text-center">
            <div className="font-display text-3xl text-ink-faint">A clear day</div>
          </div>
        )}
      </div>
    </div>
  )
}
