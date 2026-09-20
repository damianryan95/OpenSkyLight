import type Database from 'better-sqlite3'
import { DEFAULT_SETTINGS, type AppSettings, type CalendarDto, type CalendarProvider, type ChoreDto, type DayChoreDto, type OccurrenceDto, type RewardDto, type StarBalanceDto } from '../../shared/types'
import { createEventFeedService } from './eventFeeds'
import { createChoresRewardsService, type ChoresRewardsService } from './choresRewards'
import type { HouseholdSettingsService } from './settings'

/**
 * Read model used only by registered displays. It intentionally exposes no
 * parent commands: a browser kiosk can render the old UI while the dedicated
 * HTTP resources are extracted in later tickets.
 */
export function createDisplayReadService(sqlite: Database.Database, chores: ChoresRewardsService = createChoresRewardsService(sqlite), householdSettings?: HouseholdSettingsService) {
  const feeds = createEventFeedService(sqlite)

  function settings(device: { homeLayout: unknown | null; themePreference: unknown | null; sleepSettings: unknown | null; kioskPreferences: unknown | null }): AppSettings {
    const result: AppSettings = structuredClone(DEFAULT_SETTINGS)
    if (Array.isArray(device.homeLayout)) result.homeLayout = device.homeLayout as AppSettings['homeLayout']
    if (device.themePreference === 'light' || device.themePreference === 'dark' || device.themePreference === 'auto') result.theme = device.themePreference
    if (isSleep(device.sleepSettings)) result.sleep = device.sleepSettings
    if (householdSettings) result.weather = householdSettings.get().weather
    return result
  }

  function calendars(): CalendarDto[] {
    return sqlite.prepare(`
      SELECT c.id, c.name, c.color, c.selected, s.kind
      FROM calendars c JOIN calendar_sources s ON s.id = c.source_id
      WHERE c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE
    `).all()
      .map((row) => {
        const value = row as { id: string; name: string; color: string; selected: number; kind: CalendarProvider }
        return { id: value.id, name: value.name, color: value.color, provider: value.kind, readOnly: true, visible: value.selected === 1 }
      })
  }

  function occurrences(window: { start: string; end: string }): OccurrenceDto[] {
    return feeds.family(window).map((item) => ({
      key: item.key, eventId: item.eventId, masterId: item.masterId, calendarId: item.calendarId, title: item.title,
      location: item.location, start: item.start, end: item.end, allDay: item.allDay, isRecurring: item.isRecurring,
      readOnly: true, occurrenceStart: item.occurrenceStart, personIds: item.personIds
    }))
  }

  function choreDefinitions(): ChoreDto[] {
    return sqlite.prepare(`SELECT id, title, icon, person_id, stars_value, due_date, routine, active, sort_order
      FROM chores WHERE deleted_at IS NULL AND person_id IS NOT NULL ORDER BY sort_order, title`).all().map((row) => {
      const value = row as { id: string; title: string; icon: string | null; person_id: string; stars_value: number; due_date: string | null; routine: 'morning' | 'evening' | null; active: number; sort_order: number }
      return { id: value.id, title: value.title, icon: value.icon, personId: value.person_id, starsValue: value.stars_value,
        recurrence: null, anchorDate: value.due_date ?? '1970-01-01', routine: value.routine, active: value.active === 1, sortOrder: value.sort_order }
    })
  }

  function choresForDay(date: string): DayChoreDto[] {
    const rows = sqlite.prepare(`SELECT id, title, icon, person_id, stars_value, routine FROM chores
      WHERE deleted_at IS NULL AND active = 1 AND person_id IS NOT NULL ORDER BY sort_order, title`).all() as Array<{ id: string; title: string; icon: string | null; person_id: string; stars_value: number; routine: 'morning' | 'evening' | null }>
    const completed = new Set((sqlite.prepare('SELECT chore_id FROM chore_completions WHERE due_date = ?').all(date) as Array<{ chore_id: string }>).map((row) => row.chore_id))
    return rows.filter((row) => chores.isDueOn(row.id, date)).map((row) => ({
      choreId: row.id, title: row.title, icon: row.icon, personId: row.person_id, starsValue: row.stars_value,
      routine: row.routine, completed: completed.has(row.id)
    }))
  }

  function balances(): StarBalanceDto[] {
    return sqlite.prepare(`SELECT p.id AS person_id, COALESCE(SUM(l.delta), 0) AS balance FROM people p
      LEFT JOIN star_ledger l ON l.person_id = p.id WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY p.sort_order, p.created_at`).all()
      .map((row) => { const value = row as { person_id: string; balance: number }; return { personId: value.person_id, balance: value.balance } })
  }

  function rewards(): RewardDto[] {
    return sqlite.prepare(`SELECT id, title, icon, cost_stars, active FROM rewards WHERE deleted_at IS NULL ORDER BY sort_order, title`).all()
      .map((row) => { const value = row as { id: string; title: string; icon: string | null; cost_stars: number; active: number }; return { id: value.id, title: value.title, icon: value.icon, costStars: value.cost_stars, active: value.active === 1 } })
  }

  return { settings, calendars, occurrences, choreDefinitions, choresForDay, balances, rewards }
}

function isSleep(value: unknown): value is AppSettings['sleep'] {
  return typeof value === 'object' && value !== null && typeof (value as { enabled?: unknown }).enabled === 'boolean' &&
    typeof (value as { start?: unknown }).start === 'string' && typeof (value as { end?: unknown }).end === 'string'
}

export type DisplayReadService = ReturnType<typeof createDisplayReadService>
