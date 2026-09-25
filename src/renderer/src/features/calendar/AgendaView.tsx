import { eachDay } from '@shared/dates'
import { useSettings } from '../../api/hooks'
import { ZONE } from '../../stores/uiStore'
import { occurrenceColor } from '../../lib/colors'
import { isToday } from '../../lib/format'
import { EventCard } from './EventCard'
import { useCalendarData, useViewRange } from './useCalendarData'
import { useCalendarEditing } from './useEventEditor'

export function AgendaView() {
  const range = useViewRange()
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const { data: settings } = useSettings()
  const timeFormat = settings?.timeFormat ?? '12h'
  const days = eachDay(range, ZONE)
  const { unlocked, editOccurrence, createOn } = useCalendarEditing()

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-6 pb-28">
      <div className="flex flex-col gap-2">
        {days.map((day, i) => {
          const key = day.toISODate()!
          const occurrences = byDay.get(key) ?? []
          if (occurrences.length === 0) return null
          const today = isToday(key)
          return (
            <div key={key} className="animate-rise flex gap-4 py-2" style={{ animationDelay: `${i * 30}ms` }}>
              <div
                className={`pressable flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl ${
                  today ? 'bg-ember text-white shadow-card' : 'bg-paper-deep/60 text-ink'
                }`}
                {...(unlocked ? { onClick: () => createOn(key), role: 'button', tabIndex: 0 } : {})}
              >
                <span className={`text-xs font-extrabold uppercase ${today ? 'text-white/80' : 'text-ink-faint'}`}>
                  {day.toFormat('ccc')}
                </span>
                <span className="font-display text-3xl leading-none">{day.day}</span>
                <span className={`text-xs font-bold ${today ? 'text-white/80' : 'text-ink-faint'}`}>
                  {day.toFormat('LLL')}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {occurrences.map((occ) => (
                  <EventCard
                    key={occ.key}
                    occ={occ}
                    color={occurrenceColor(occ, peopleById, calendarsById)}
                    timeFormat={timeFormat}
                    peopleById={peopleById}
                    size="lg"
                    onSelect={editOccurrence}
                  />
                ))}
              </div>
            </div>
          )
        })}
        {[...byDay.values()].every((v) => v.length === 0) && (
          <div className="animate-rise mt-20 text-center font-display text-3xl text-ink-faint">
            Nothing coming up — enjoy the quiet
          </div>
        )}
      </div>
    </div>
  )
}
