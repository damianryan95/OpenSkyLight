import type Database from 'better-sqlite3'
import { uuidv7 } from '../../shared/uuid'
import type { MealSlotDto, MealSlotKind } from '../../shared/types'
import { DateTime } from 'luxon'

interface MealSlotRow {
  date: string
  slot: MealSlotKind
  free_text: string
}

/** Electron-independent meal-plan services with display-safe reads and parent-only writes. */
export function createMealsDomain(sqlite: Database.Database) {
  /** Returns populated meal slots in an inclusive date range, in display order. */
  function getRange(start: string, end: string): MealSlotDto[] {
    const rows = sqlite
      .prepare(
        `SELECT date, slot, free_text
         FROM meal_slots
         WHERE date >= ? AND date <= ? AND length(trim(COALESCE(free_text, ''))) > 0
         ORDER BY date ASC,
           CASE slot WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 WHEN 'snack' THEN 4 END ASC`
      )
      .all(start, end) as MealSlotRow[]
    const explicit = rows.filter((row) => row.slot !== ('snack' as MealSlotKind)).map((row) => ({ date: row.date, slot: row.slot, text: row.free_text }))
    const byKey = new Map(explicit.map((meal) => [`${meal.date}:${meal.slot}`, meal]))
    const templates = getTemplates()
    for (let day = DateTime.fromISO(start); day.isValid && day.toISODate()! <= end; day = day.plus({ days: 1 })) {
      const date = day.toISODate()!
      for (const template of templates.filter((value) => value.dayOfWeek === day.weekday)) {
        const key = `${date}:${template.slot}`
        if (!byKey.has(key)) byKey.set(key, { date, slot: template.slot, text: template.text })
      }
    }
    const order: Record<MealSlotKind, number> = { breakfast: 1, lunch: 2, dinner: 3 }
    return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || order[a.slot] - order[b.slot])
  }

  /** Blank values remove the slot, matching the existing meal-plan behavior. */
  function set(date: string, slot: MealSlotKind, text: string | null): void {
    const normalizedText = text?.trim() ?? ''
    if (normalizedText === '') {
      sqlite.prepare('DELETE FROM meal_slots WHERE date = ? AND slot = ?').run(date, slot)
      return
    }

    sqlite
      .prepare(
        `INSERT INTO meal_slots (id, date, slot, free_text) VALUES (?, ?, ?, ?)
         ON CONFLICT(date, slot) DO UPDATE SET free_text = excluded.free_text`
      )
      .run(uuidv7(), date, slot, normalizedText)
  }

  function getTemplates(): Array<{ dayOfWeek: number; slot: MealSlotKind; text: string }> {
    return (sqlite.prepare("SELECT day_of_week, slot, free_text FROM meal_templates ORDER BY day_of_week, CASE slot WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 ELSE 3 END").all() as Array<{ day_of_week: number; slot: MealSlotKind; free_text: string }>).map((row) => ({ dayOfWeek: row.day_of_week, slot: row.slot, text: row.free_text }))
  }
  function setTemplate(dayOfWeek: number, slot: MealSlotKind, text: string | null): void {
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) throw new Error('Meal template weekday must be between 1 and 7')
    const normalized = text?.trim() ?? ''
    if (!normalized) { sqlite.prepare('DELETE FROM meal_templates WHERE day_of_week = ? AND slot = ?').run(dayOfWeek, slot); return }
    sqlite.prepare('INSERT INTO meal_templates (day_of_week, slot, free_text) VALUES (?, ?, ?) ON CONFLICT(day_of_week, slot) DO UPDATE SET free_text = excluded.free_text').run(dayOfWeek, slot, normalized)
  }

  return { queries: { getRange, getTemplates }, parentCommands: { set, setTemplate } }
}

export type MealsDomain = ReturnType<typeof createMealsDomain>
