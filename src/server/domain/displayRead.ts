import type Database from 'better-sqlite3'
import { DEFAULT_SETTINGS, type AppSettings, type CalendarDto, type CalendarProvider, type ChoreDto, type DayChoreDto, type EventDto, type OccurrenceDto, type RewardDto, type StarBalanceDto } from '../../shared/types'
import { parseRRuleString } from '../../shared/recurrence/build'
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

  /**
   * `readOnly` is a property of the calendar, not of the client asking.
   *
   * It was previously hardcoded true, which was accurate while nothing could
   * write anywhere. Since `N06` it answers the real question — will this
   * calendar accept a change — and an ICS subscription is the case where the
   * answer is permanently no. Whether *this* client may edit is a separate
   * question, settled by the PIN gate on the write channel.
   */
  function calendars(): CalendarDto[] {
    return sqlite.prepare(`
      SELECT c.id, c.name, c.color, c.selected, c.read_only, s.kind
      FROM calendars c JOIN calendar_sources s ON s.id = c.source_id
      WHERE c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE
    `).all()
      .map((row) => {
        const value = row as { id: string; name: string; color: string; selected: number; read_only: number; kind: CalendarProvider }
        return { id: value.id, name: value.name, color: value.color, provider: value.kind, readOnly: value.read_only === 1, visible: value.selected === 1 }
      })
  }

  function occurrences(window: { start: string; end: string }): OccurrenceDto[] {
    const writable = new Set(calendars().filter((calendar) => !calendar.readOnly).map((calendar) => calendar.id))
    return feeds.family(window).map((item) => ({
      key: item.key, eventId: item.eventId, masterId: item.masterId, calendarId: item.calendarId, title: item.title,
      location: item.location, start: item.start, end: item.end, allDay: item.allDay, isRecurring: item.isRecurring,
      readOnly: !writable.has(item.calendarId), occurrenceStart: item.occurrenceStart, personIds: item.personIds
    }))
  }

  /**
   * One event in full, for an editor to pre-fill from.
   *
   * A read, and deliberately so: the occurrence feed carries what a board needs
   * to *render* an event, and an editor additionally needs the fields nothing
   * displays — its description, the zone its recurrence pattern lives in, and the
   * rule itself. Returning null for an unknown id rather than throwing keeps a
   * stale tap on a deleted event from looking like a failure.
   */
  function event(id: string): EventDto | null {
    const row = sqlite.prepare(`
      SELECT e.id, e.calendar_id, e.title, e.description, e.location, e.start_at, e.end_at, e.timezone,
             e.all_day, e.recurrence, e.recurring_event_id, e.original_start_at, e.status,
             e.audience_person_id, c.audience_person_id AS calendar_person_id, c.read_only
      FROM events e JOIN calendars c ON c.id = e.calendar_id
      WHERE e.id = ? AND c.deleted_at IS NULL
    `).get(id) as {
      id: string; calendar_id: string; title: string; description: string | null; location: string | null
      start_at: string; end_at: string; timezone: string; all_day: number; recurrence: string | null
      recurring_event_id: string | null; original_start_at: string | null; status: 'confirmed' | 'cancelled'
      audience_person_id: string | null; calendar_person_id: string | null; read_only: number
    } | undefined
    if (row === undefined) return null
    const personId = row.audience_person_id ?? row.calendar_person_id
    return {
      id: row.id,
      calendarId: row.calendar_id,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      tz: row.timezone,
      allDay: row.all_day === 1,
      rrule: row.recurrence,
      recurrence: row.recurrence === null ? null : parseRRuleString(row.recurrence, row.timezone),
      recurringEventId: row.recurring_event_id,
      originalStartAt: row.original_start_at,
      status: row.status,
      readOnly: row.read_only === 1,
      // The tag alone, not the inferred audience: an editor must show what was
      // chosen, and offer to change it, rather than what a title happens to imply.
      personIds: personId === null ? [] : [personId]
    }
  }

  /**
   * Chore definitions in the legacy shape the kiosk editor was written for.
   * The schedule is parsed rather than dropped: before `N20` this reported every
   * chore as `recurrence: null`, which a display could not act on — but an
   * editor on the wall would have shown a weekly chore as "once" and, on save,
   * silently wiped its schedule. A rule the simplified model cannot express
   * still comes back null, and the editor treats that as "leave it alone".
   */
  function choreDefinitions(): ChoreDto[] {
    const timezone = householdSettings?.get().timezone ?? 'UTC'
    return sqlite.prepare(`SELECT id, title, icon, person_id, stars_value, due_date, schedule_rrule, routine, active, sort_order
      FROM chores WHERE deleted_at IS NULL AND person_id IS NOT NULL ORDER BY sort_order, title`).all().map((row) => {
      const value = row as { id: string; title: string; icon: string | null; person_id: string; stars_value: number; due_date: string | null; schedule_rrule: string | null; routine: 'morning' | 'evening' | null; active: number; sort_order: number }
      return { id: value.id, title: value.title, icon: value.icon, personId: value.person_id, starsValue: value.stars_value,
        recurrence: value.schedule_rrule === null ? null : parseRRuleString(value.schedule_rrule, timezone),
        anchorDate: value.due_date ?? '1970-01-01', routine: value.routine, active: value.active === 1, sortOrder: value.sort_order }
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

  return { settings, calendars, occurrences, event, choreDefinitions, choresForDay, balances, rewards }
}

function isSleep(value: unknown): value is AppSettings['sleep'] {
  return typeof value === 'object' && value !== null && typeof (value as { enabled?: unknown }).enabled === 'boolean' &&
    typeof (value as { start?: unknown }).start === 'string' && typeof (value as { end?: unknown }).end === 'string'
}

export type DisplayReadService = ReturnType<typeof createDisplayReadService>
