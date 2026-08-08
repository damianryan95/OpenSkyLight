import { z } from 'zod'

const isoInstant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO datetime')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid ISO date')
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalid color')
const id = z.string().min(1)

export const personCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: hexColor,
  role: z.enum(['parent', 'child'])
})

export const personUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60).optional(),
  color: hexColor.optional(),
  role: z.enum(['parent', 'child']).optional(),
  sortOrder: z.number().int().optional()
})

export const calendarCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: hexColor
})

export const calendarUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80).optional(),
  color: hexColor.optional(),
  visible: z.boolean().optional()
})

export const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(99).optional(),
  byWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  untilDate: isoDate.optional(),
  count: z.number().int().min(1).max(999).optional()
})

export const occurrenceQuerySchema = z.object({
  start: isoInstant,
  end: isoInstant
})

const homeTileSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum([
    'todayEvents',
    'weekAgenda',
    'weather',
    'choresProgress',
    'familyChores',
    'familyRewards',
    'starBalances',
    'list',
    'meals',
    'clock',
    'photo',
    'news',
    'timer'
  ]),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(5),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(6),
  // value bounds must be >= what sanitizeLayout keeps (1..200), or a renderable
  // layout could be unsaveable
  config: z
    .object({
      listId: z.string().min(1).max(200).optional(),
      feedId: z.string().min(1).max(200).optional(),
    })
    .optional()
})

export const rssFeedSchema = z.object({ feedId: z.string().min(1).max(40) })

export const settingsPatchSchema = z.object({
  patch: z
    .object({
      weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
      defaultView: z.enum(['home', 'day', 'week', 'month', 'agenda', 'chores', 'lists']).optional(),
      homeLayout: z.array(homeTileSchema).max(24).optional(),
      timeFormat: z.enum(['12h', '24h']).optional(),
      temperatureUnit: z.enum(['f', 'c']).optional(),
      theme: z.enum(['light', 'dark', 'auto']).optional(),
      weather: z.object({ lat: z.number(), lon: z.number(), label: z.string() }).nullable().optional(),
      sleep: z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }).optional(),
      screensaver: z.object({ folder: z.string().nullable(), idleMinutes: z.number().int().min(1).max(120) }).optional(),
      launchOnStartup: z.boolean().optional(),
      companion: z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535) }).optional()
    })
    .strict()
})

export const idSchema = z.object({ id })
export const voidSchema = z.void().or(z.undefined()).or(z.null())

export const googleCredentialsSchema = z.object({
  clientId: z.string().trim().min(10),
  clientSecret: z.string().trim().min(5)
})

export const accountIdSchema = z.object({ accountId: id })

export const googleCalendarSelectSchema = z.object({
  accountId: id,
  googleCalendarId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  color: hexColor,
  readOnly: z.boolean(),
  selected: z.boolean()
})

export const icsAddSchema = z.object({
  url: z.string().trim().url().max(2000),
  name: z.string().trim().min(1).max(80),
  color: hexColor
})

const routine = z.enum(['morning', 'evening']).nullable()

export const choreCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  personId: id,
  starsValue: z.number().int().min(0).max(99),
  recurrence: recurrenceSchema.nullish(),
  anchorDate: isoDate.optional(),
  routine: routine.optional()
})

export const choreUpdateSchema = z.object({
  id,
  title: z.string().trim().min(1).max(120).optional(),
  personId: id.optional(),
  starsValue: z.number().int().min(0).max(99).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  anchorDate: isoDate.optional(),
  routine: routine.optional(),
  active: z.boolean().optional()
})

export const choreDaySchema = z.object({ date: isoDate })
export const choreCheckSchema = z.object({ choreId: id, date: isoDate })

export const rewardCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  costStars: z.number().int().min(1).max(9999)
})

export const rewardUpdateSchema = z.object({
  id,
  title: z.string().trim().min(1).max(120).optional(),
  costStars: z.number().int().min(1).max(9999).optional(),
  active: z.boolean().optional()
})

export const redeemSchema = z.object({ rewardId: id, personId: id })
export const grantSchema = z.object({ redemptionId: id })

export const listCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: hexColor,
  kind: z.enum(['grocery', 'todo', 'custom'])
})

export const listUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80).optional(),
  color: hexColor.optional()
})

export const listItemAddSchema = z.object({ listId: id, text: z.string().trim().min(1).max(300) })
export const listIdSchema = z.object({ listId: id })

export const mealsRangeSchema = z.object({ start: isoDate, end: isoDate })
export const mealSetSchema = z.object({
  date: isoDate,
  slot: z.enum(['breakfast', 'lunch', 'dinner']),
  text: z.string().trim().max(200).nullable()
})

export const citySearchSchema = z.object({ query: z.string().trim().min(2).max(80) })

export const pinVerifySchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) })

export const pinSetSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/).nullable() })
