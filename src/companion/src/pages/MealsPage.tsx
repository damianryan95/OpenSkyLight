import { useState } from 'react'
import { DateTime } from 'luxon'
import { MEAL_SLOTS, type MealSlotKind } from '@shared/types'
import { useMealMutations, useMeals } from '../api/hooks'
import { Card, PrimaryButton, TextInput } from '../components/ui'

const SLOT_COLORS: Record<MealSlotKind, string> = {
  breakfast: '#FFB224',
  lunch: '#46A758',
  dinner: '#D95B3A'
}

export function MealsPage() {
  const today = DateTime.now().startOf('day')
  const start = today.toISODate()!
  const end = today.plus({ days: 6 }).toISODate()!
  const { data: meals = [] } = useMeals(start, end)
  const mutations = useMealMutations()
  const [editing, setEditing] = useState<{ date: string; slot: MealSlotKind; text: string } | null>(null)

  const mealFor = (date: string, slot: MealSlotKind): string | null =>
    meals.find((m) => m.date === date && m.slot === slot)?.text ?? null

  const save = (): void => {
    if (!editing) return
    const text = editing.text.trim()
    mutations.set.mutate({ date: editing.date, slot: editing.slot, text: text === '' ? null : text })
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 7 }, (_, i) => {
        const day = today.plus({ days: i })
        const date = day.toISODate()!
        return (
          <Card key={date}>
            <h2 className="mb-1 font-display text-xl font-semibold">
              {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : day.toFormat('cccc')}
              <span className="ml-2 text-base font-bold text-ink-faint">{day.toFormat('LLL d')}</span>
            </h2>
            {MEAL_SLOTS.map((slot) => {
              const text = mealFor(date, slot)
              const isEditing = editing?.date === date && editing.slot === slot
              return (
                <div key={slot} className="flex min-h-11 items-center gap-3 border-b border-line/60 last:border-0">
                  <span
                    className="w-20 shrink-0 text-sm font-extrabold uppercase"
                    style={{ color: SLOT_COLORS[slot] }}
                  >
                    {slot}
                  </span>
                  {isEditing ? (
                    <form
                      className="flex min-w-0 flex-1 gap-2 py-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        save()
                      }}
                    >
                      <TextInput
                        value={editing.text}
                        onChange={(t) => setEditing({ ...editing, text: t })}
                        placeholder="What's cooking?"
                        autoFocus
                      />
                      <PrimaryButton type="submit">Save</PrimaryButton>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing({ date, slot, text: text ?? '' })}
                      className="pressable min-w-0 flex-1 py-2 text-left text-base font-semibold"
                    >
                      {text ?? <span className="text-ink-faint">Add…</span>}
                    </button>
                  )}
                </div>
              )
            })}
          </Card>
        )
      })}
    </div>
  )
}
