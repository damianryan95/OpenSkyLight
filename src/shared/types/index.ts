import type { BuiltInPersonThemeId, PersonPersonalization } from '../personalization'

export type PersonRole = 'parent' | 'child'

export interface PersonDto extends PersonPersonalization {
  id: string
  name: string
  color: string
  role: PersonRole
  sortOrder: number
  avatarUrl: string | null
}

export interface PersonCreateInput {
  name: string
  color: string
  role: PersonRole
  avatarData?: string | null
  themeId?: BuiltInPersonThemeId | null
  celebrationAssetId?: string | null
  celebrationEnabled?: boolean
  celebrationDurationMs?: number
}

export interface PersonUpdateInput {
  id: string
  name?: string
  color?: string
  role?: PersonRole
  sortOrder?: number
  avatarData?: string | null
  themeId?: BuiltInPersonThemeId | null
  celebrationAssetId?: string | null
  celebrationEnabled?: boolean
  celebrationDurationMs?: number
}

export type CalendarProvider = 'local' | 'google' | 'ics'

export interface CalendarDto {
  id: string
  provider: CalendarProvider
  name: string
  color: string
  readOnly: boolean
  visible: boolean
}

export interface CalendarCreateInput {
  name: string
  color: string
}

export interface CalendarUpdateInput {
  id: string
  name?: string
  color?: string
  visible?: boolean
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** Simplified recurrence model used by the UI; converted to/from RRULE strings. */
export interface RecurrenceInput {
  freq: RecurrenceFreq
  interval?: number
  /** 0 = Monday ... 6 = Sunday (rrule convention) */
  byWeekdays?: number[]
  /** ISO date (inclusive last day the rule applies) */
  untilDate?: string
  count?: number
}

export type EventStatus = 'confirmed' | 'cancelled'

export interface EventDto {
  id: string
  calendarId: string
  title: string
  description: string | null
  location: string | null
  /** UTC ISO instant */
  startAt: string
  endAt: string
  /** IANA zone the event was created in */
  tz: string
  allDay: boolean
  rrule: string | null
  recurrence: RecurrenceInput | null
  recurringEventId: string | null
  originalStartAt: string | null
  status: EventStatus
  readOnly: boolean
  personIds: string[]
}

export interface OccurrenceDto {
  /** Unique per occurrence: `${eventId}|${occurrenceStart}` */
  key: string
  /** Row that holds this occurrence's data (exception row id if overridden) */
  eventId: string
  /** Master series row id (= eventId when not an exception) */
  masterId: string
  calendarId: string
  title: string
  location: string | null
  /** UTC ISO instants */
  start: string
  end: string
  allDay: boolean
  isRecurring: boolean
  readOnly: boolean
  /** Original (pre-override) start; the key used for `this`/`following` edits */
  occurrenceStart: string
  personIds: string[]
}

export type CalendarViewKind = 'home' | 'day' | 'week' | 'month' | 'agenda' | 'chores' | 'lists'

export type HomeTileType =
  | 'todayEvents'
  | 'weekAgenda'
  | 'weather'
  | 'choresProgress'
  | 'familyChores'
  | 'starBalances'
  | 'familyRewards'
  | 'list'
  | 'meals'
  | 'clock'
  | 'photo'
  | 'news'
  | 'timer'

export interface HomeTileConfig {
  /** 'list' tiles: which list to show */
  listId?: string
  /** 'news' tiles: which preset feed (see shared/rss.ts) */
  feedId?: string
}

export interface HomeTile {
  id: string
  type: HomeTileType
  /** grid cell coords (0-based) and spans */
  x: number
  y: number
  w: number
  h: number
  config?: HomeTileConfig
}

export type ListKind = 'grocery' | 'todo' | 'custom'

export interface ListItemDto {
  id: string
  text: string
  checked: boolean
  sortOrder: number
}

export interface ListDto {
  id: string
  name: string
  color: string
  kind: ListKind
  items: ListItemDto[]
}

export type MealSlotKind = 'breakfast' | 'lunch' | 'dinner'

export const MEAL_SLOTS: MealSlotKind[] = ['breakfast', 'lunch', 'dinner']

export interface MealSlotDto {
  /** YYYY-MM-DD */
  date: string
  slot: MealSlotKind
  text: string
}

export type ChoreRoutine = 'morning' | 'evening' | null

export interface ChoreDto {
  id: string
  title: string
  icon: string | null
  personId: string
  starsValue: number
  /** null = one-time chore on anchorDate */
  recurrence: RecurrenceInput | null
  /** YYYY-MM-DD; first day the chore applies (and the only day for one-offs) */
  anchorDate: string
  routine: ChoreRoutine
  active: boolean
  sortOrder: number
}

export interface ChoreCreateInput {
  title: string
  icon?: string | null
  personId: string
  starsValue: number
  recurrence?: RecurrenceInput | null
  anchorDate?: string
  routine?: ChoreRoutine
}

export interface ChoreUpdateInput {
  id: string
  title?: string
  icon?: string | null
  personId?: string
  starsValue?: number
  recurrence?: RecurrenceInput | null
  anchorDate?: string
  routine?: ChoreRoutine
  active?: boolean
}

export interface DayChoreDto {
  choreId: string
  title: string
  icon: string | null
  personId: string
  starsValue: number
  routine: ChoreRoutine
  completed: boolean
}

export interface StarBalanceDto {
  personId: string
  balance: number
}

export interface RewardDto {
  id: string
  title: string
  icon: string | null
  costStars: number
  active: boolean
}

export interface RewardCreateInput {
  title: string
  icon?: string | null
  costStars: number
}

export interface RewardUpdateInput {
  id: string
  title?: string
  icon?: string | null
  costStars?: number
  active?: boolean
}

export interface RedemptionDto {
  id: string
  rewardId: string
  rewardTitle: string
  personId: string
  starsSpent: number
  redeemedAt: string
  status: 'pending' | 'granted'
}

export interface AppSettings {
  /** 0 = Sunday, 1 = Monday */
  weekStartsOn: 0 | 1
  defaultView: CalendarViewKind
  timeFormat: '12h' | '24h'
  temperatureUnit: 'f' | 'c'
  /** 'auto' = dark from sunset to sunrise (sun times from the weather location) */
  theme: 'light' | 'dark' | 'auto'
  weather: { lat: number; lon: number; label: string } | null
  sleep: { enabled: boolean; start: string; end: string }
  screensaver: { folder: string | null; idleMinutes: number }
  launchOnStartup: boolean
  homeLayout: HomeTile[]
  /** LAN companion web app (phones editing lists/meals/chores) */
  companion: { enabled: boolean; port: number }
}

import { DEFAULT_HOME_LAYOUT } from '../home'

export const DEFAULT_SETTINGS: AppSettings = {
  weekStartsOn: 0,
  defaultView: 'home',
  timeFormat: '12h',
  temperatureUnit: 'f',
  theme: 'auto',
  weather: null,
  sleep: { enabled: false, start: '21:30', end: '06:30' },
  screensaver: { folder: null, idleMinutes: 10 },
  launchOnStartup: false,
  homeLayout: DEFAULT_HOME_LAYOUT,
  companion: { enabled: false, port: 8420 }
}

/** Touch-friendly person color palette (Skylight-style) */
export const PERSON_COLORS = [
  '#E5484D', // red
  '#F76B15', // orange
  '#FFB224', // amber
  '#46A758', // green
  '#12A594', // teal
  '#0091FF', // blue
  '#6E56CF', // violet
  '#D6409F', // pink
  '#8E4EC6', // purple
  '#00749E' // deep cyan
] as const

export const CALENDAR_COLORS = PERSON_COLORS
