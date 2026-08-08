import { useState } from 'react'
import { DateTime } from 'luxon'
import { MEAL_SLOTS, type MealSlotDto, type MealSlotKind } from '@shared/types'
import { useMealMutations, useMeals } from '../../api/hooks'
import { Dialog, BigButton, FieldLabel } from '../../components/ui'
import { OskInput } from '../../components/Osk'
import { ZONE } from '../../stores/uiStore'
import { isDisplayClient } from '../../lib/clientMode'

export const SLOT_META: Record<MealSlotKind, { letter: string; label: string; color: string }> = {
  breakfast: { letter: 'B', label: 'Breakfast', color: '#FFB224' },
  lunch: { letter: 'L', label: 'Lunch', color: '#46A758' },
  dinner: { letter: 'D', label: 'Dinner', color: '#D95B3A' }
}

/** Meals for the days covered by a UTC instant range (as used by calendar views). */
export function useMealsForRange(range: { start: string; end: string }) {
  const startDate = DateTime.fromISO(range.start, { zone: 'utc' }).setZone(ZONE).toISODate()!
  const endDate = DateTime.fromISO(range.end, { zone: 'utc' }).setZone(ZONE).minus({ milliseconds: 1 }).toISODate()!
  const { data } = useMeals(startDate, endDate)
  const byDay = new Map<string, MealSlotDto[]>()
  for (const m of data ?? []) {
    const arr = byDay.get(m.date) ?? []
    arr.push(m)
    byDay.set(m.date, arr)
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot))
  }
  return byDay
}

/** Compact per-day strip shown at the bottom of week columns / day view. */
export function MealStrip({
  date,
  meals,
  onOpen,
  compact = true
}: {
  date: string
  meals: MealSlotDto[]
  onOpen: (date: string) => void
  compact?: boolean
}) {
  const display = isDisplayClient()
  if (display) {
    return (
      <div className="w-full rounded-xl border border-dashed border-line/80 bg-card/50 px-2 py-1.5 text-left">
        {meals.length === 0 ? (
          <span className={`font-bold text-ink-faint ${compact ? 'text-xs' : 'text-sm'}`}>Meals not planned</span>
        ) : (
          <MealLines meals={meals} compact={compact} />
        )}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(date)}
      className="pressable w-full rounded-xl border border-dashed border-line/80 bg-card/50 px-2 py-1.5 text-left"
    >
      {meals.length === 0 ? (
        <span className={`font-bold text-ink-faint ${compact ? 'text-xs' : 'text-sm'}`}>+ Meals</span>
      ) : (
        <MealLines meals={meals} compact={compact} />
      )}
    </button>
  )
}

function MealLines({ meals, compact }: { meals: MealSlotDto[]; compact: boolean }) {
  return <span className="flex flex-col gap-0.5">{meals.map((m) => (
    <span key={m.slot} className={`flex items-center gap-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ backgroundColor: SLOT_META[m.slot].color }}>{SLOT_META[m.slot].letter}</span>
      <span className="truncate font-bold text-ink-soft">{m.text}</span>
    </span>
  ))}</span>
}

export function MealsDialog({
  date,
  meals,
  onClose
}: {
  date: string | null
  meals: MealSlotDto[]
  onClose: () => void
}) {
  const mutations = useMealMutations()
  const [values, setValues] = useState<Record<MealSlotKind, string> | null>(null)
  if (!date) return null

  const current: Record<MealSlotKind, string> =
    values ??
    (Object.fromEntries(
      MEAL_SLOTS.map((slot) => [slot, meals.find((m) => m.slot === slot)?.text ?? ''])
    ) as Record<MealSlotKind, string>)

  const save = (): void => {
    for (const slot of MEAL_SLOTS) {
      const original = meals.find((m) => m.slot === slot)?.text ?? ''
      if (current[slot].trim() !== original) {
        mutations.set.mutate({ date, slot, text: current[slot].trim() || null })
      }
    }
    onClose()
  }

  return (
    <Dialog open onClose={onClose} title={`Meals · ${DateTime.fromISO(date, { zone: ZONE }).toFormat('ccc, LLL d')}`}>
      <div className="flex flex-col gap-3">
        {MEAL_SLOTS.map((slot) => (
          <div key={slot}>
            <FieldLabel>{SLOT_META[slot].label}</FieldLabel>
            <OskInput
              value={current[slot]}
              onChange={(v) => setValues({ ...current, [slot]: v })}
              placeholder={`What's for ${slot}?`}
            />
          </div>
        ))}
        <div className="mt-1 flex gap-3">
          <div className="flex-1" />
          <BigButton variant="ghost" onClick={onClose}>
            Cancel
          </BigButton>
          <BigButton onClick={save}>Save</BigButton>
        </div>
      </div>
    </Dialog>
  )
}
