import { z } from 'zod'
import { CHORE_ICON_IDS } from '../choreIcons'
import { BUILT_IN_PERSON_THEME_IDS } from '../personalization'

/**
 * Shared, browser-safe description of the version-one HTTP boundary. Domain
 * DTOs will be added here as their server services are extracted.
 */
export const apiVersion = 'v1' as const
export const apiPrefix = `/api/${apiVersion}` as const

export const apiInfoResponseSchema = z.object({
  version: z.literal(apiVersion)
})

export const apiInfoRequestSchema = z.object({}).strict()

export const displaySettingsSchema = z.object({
  homeLayout: z.unknown().optional(),
  themePreference: z.unknown().optional(),
  sleepSettings: z.unknown().optional(),
  kioskPreferences: z.unknown().optional()
}).strict()

export const displayDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  homeLayout: z.unknown().nullable(),
  themePreference: z.unknown().nullable(),
  sleepSettings: z.unknown().nullable(),
  kioskPreferences: z.unknown().nullable(),
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable()
})

export const registerDisplayRequestSchema = displaySettingsSchema.extend({ name: z.string().min(1).max(120) })
export const updateDisplayRequestSchema = displaySettingsSchema.extend({ name: z.string().min(1).max(120).optional() }).refine(
  (value) => Object.keys(value).length > 0, { message: 'At least one display field is required' }
)
export const registeredDisplaySchema = displayDeviceSchema.extend({ credential: z.string().min(1) })

/** A display may submit a date, but the server compares it to household today. */
export const displayChoreCommandRequestSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be an ISO calendar date')
}).strict()

export const displayChoreCommandResponseSchema = z.object({
  completionId: z.string(),
  balance: z.number().int(),
  created: z.boolean()
})

/** Parent-admin people and read-only Google calendar configuration DTOs. */
export const householdRoleSchema = z.enum(['parent', 'child'])
export const personThemeIdSchema = z.enum(BUILT_IN_PERSON_THEME_IDS)
export const personPersonalizationSchema = z.object({
  themeId: personThemeIdSchema.nullable(),
  celebrationAssetId: z.string().min(1).max(120).nullable(),
  celebrationAssetIds: z.array(z.string().min(1).max(120)).max(20),
  celebrationEnabled: z.boolean(),
  celebrationDurationMs: z.number().int().min(1_500).max(5_000)
})
export const personPersonalizationPatchSchema = personPersonalizationSchema.partial()
export const personSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  role: householdRoleSchema,
  sortOrder: z.number().int().nonnegative(),
  avatarUrl: z.string().max(1_500_000).nullable()
}).merge(personPersonalizationSchema)
export const createPersonRequestSchema = personSchema.pick({ name: true, color: true, role: true }).extend({ avatarData: z.string().max(1_500_000).nullable().optional() }).merge(personPersonalizationPatchSchema)
export const updatePersonRequestSchema = createPersonRequestSchema.partial().extend({ sortOrder: z.number().int().nonnegative().optional(), avatarData: z.string().max(1_500_000).nullable().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one person field is required' })

export const googleAccountSchema = z.object({
  id: z.string().min(1), email: z.string().min(1), state: z.enum(['connected', 'reauthorization_required']),
  error: z.string().nullable(), connectedAt: z.string().datetime()
})
export const remoteCalendarSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), color: z.string().min(1), primary: z.boolean(), readOnly: z.boolean()
})
export const discoveredCalendarSchema = remoteCalendarSchema.extend({ selected: z.boolean(), audiencePersonId: z.string().min(1).nullable() })
export const setCalendarSelectionRequestSchema = z.object({
  calendar: remoteCalendarSchema,
  selected: z.boolean(),
  audiencePersonId: z.string().min(1).nullable()
}).strict()
export const googleConfigurationSchema = z.object({ configured: z.boolean(), unlocked: z.boolean(), redirectUri: z.string().url().nullable() })
export const configureGoogleRequestSchema = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1), publicUrl: z.string().url() }).strict()
export const householdSettingsSchema = z.object({ timezone: z.string().min(1), weather: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), label: z.string().min(1).max(120) }).nullable() })
export const updateHouseholdSettingsRequestSchema = householdSettingsSchema.pick({ timezone: true, weather: true }).partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one household setting is required' })

/** Parent-only chores, ledger and rewards administration. RRULE is stored in
 * the server's canonical form, keeping recurrence expansion deterministic. */
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO calendar date')
const choreIconSchema = z.string().max(45_000).refine((value) => CHORE_ICON_IDS.includes(value) || value.startsWith('data:image/svg+xml;base64,'), 'Unknown icon')
export const choreAdminSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), icon: choreIconSchema.nullable(), personId: z.string().min(1), starsValue: z.number().int().nonnegative(),
  dueDate: calendarDateSchema, scheduleRrule: z.string().min(1).nullable(), routine: z.enum(['morning', 'evening']).nullable(), active: z.boolean()
})
export const createChoreRequestSchema = choreAdminSchema.pick({ title: true, personId: true, starsValue: true, dueDate: true, scheduleRrule: true, routine: true }).extend({ icon: choreIconSchema.nullable().optional() })
export const updateChoreRequestSchema = createChoreRequestSchema.partial().extend({ active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, { message: 'At least one chore field is required' })
export const choreCorrectionRequestSchema = z.object({ dueDate: calendarDateSchema }).strict()
export const starAdjustmentRequestSchema = z.object({ personId: z.string().min(1), delta: z.number().int().refine((delta) => delta !== 0, 'delta must not be zero') }).strict()
export const rewardAdminSchema = z.object({ id: z.string().min(1), title: z.string().min(1), icon: choreIconSchema.nullable(), costStars: z.number().int().positive(), active: z.boolean() })
export const createRewardRequestSchema = rewardAdminSchema.pick({ title: true, costStars: true }).extend({ icon: choreIconSchema.nullable().optional() })
export const updateRewardRequestSchema = createRewardRequestSchema.partial().extend({ active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, { message: 'At least one reward field is required' })
export const redeemRewardRequestSchema = z.object({ personId: z.string().min(1) }).strict()
export const redemptionSchema = z.object({ id: z.string().min(1), rewardId: z.string().min(1), personId: z.string().min(1), starsSpent: z.number().int().positive(), redeemedAt: z.string().datetime(), status: z.enum(['pending', 'granted', 'cancelled']), rewardTitle: z.string().min(1) })

/** Parent administration DTOs. Display reads deliberately use the separate
 * RPC whitelist, so none of these command shapes leak to kiosk clients. */
export const listKindSchema = z.enum(['grocery', 'todo', 'custom'])
export const listItemSchema = z.object({ id: z.string().min(1), text: z.string().min(1), checked: z.boolean(), sortOrder: z.number().int().nonnegative() })
export const listSchema = z.object({ id: z.string().min(1), name: z.string().min(1), color: z.string().min(1), kind: listKindSchema, items: z.array(listItemSchema) })
export const createListRequestSchema = listSchema.pick({ name: true, color: true, kind: true })
export const updateListRequestSchema = createListRequestSchema.pick({ name: true, color: true }).partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one list field is required' })
export const addListItemRequestSchema = z.object({ text: z.string().trim().min(1).max(500) }).strict()
export const mealSlotKindSchema = z.enum(['breakfast', 'lunch', 'dinner'])
export const mealSlotSchema = z.object({ date: calendarDateSchema, slot: mealSlotKindSchema, text: z.string().min(1) })
export const mealRangeRequestSchema = z.object({ start: calendarDateSchema, end: calendarDateSchema }).strict().refine(
  ({ start, end }) => start <= end, { message: 'start must not be after end' }
)
export const setMealRequestSchema = z.object({ text: z.string().max(500).nullable() }).strict()
export const setMealTemplateRequestSchema = z.object({ text: z.string().max(500).nullable() }).strict()

export const apiErrorCodeSchema = z.enum([
  'bad_request',
  'invalid_json',
  'payload_too_large',
  'not_found',
  'method_not_allowed',
  'unauthorized',
  'internal_error',
  'forbidden',
  'conflict',
  'rate_limited',
  'service_unavailable'
])

export const eventStreamPrincipalSchema = z.object({
  type: z.enum(['parent', 'display']),
  id: z.string().min(1)
})

export const queryInvalidationEventSchema = z.object({
  resources: z.array(z.string().min(1)).min(1)
})

export const syncStatusEventSchema = z.object({
  state: z.enum(['never_synced', 'fresh', 'stale', 'syncing', 'failed', 'idle', 'healthy', 'error']),
  lastSyncedAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable().optional(),
  lastSucceededAt: z.string().datetime().nullable().optional(),
  staleAfter: z.string().datetime().nullable().optional(),
  calendars: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    lastAttemptAt: z.string().datetime().nullable(),
    lastSucceededAt: z.string().datetime().nullable(),
    error: z.string().nullable()
  })).optional()
})

export const choreChangedEventSchema = z.object({
  choreId: z.string().min(1),
  personId: z.string().min(1),
  completionId: z.string().min(1).nullable(),
  changedAt: z.string().datetime()
})

/** The intentionally small payload seam for the later kiosk celebration UI. */
export const celebrationEventSchema = z.object({
  completionId: z.string().min(1),
  choreId: z.string().min(1),
  personId: z.string().min(1),
  stars: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
  initiatingDisplayId: z.string().min(1).nullable()
})

export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('query.invalidated'), data: queryInvalidationEventSchema }),
  z.object({ id: z.string().min(1), type: z.literal('sync.status'), data: syncStatusEventSchema }),
  z.object({ id: z.string().min(1), type: z.literal('chore.changed'), data: choreChangedEventSchema }),
  z.object({ id: z.string().min(1), type: z.literal('celebration.requested'), data: celebrationEventSchema }),
  z.object({ id: z.string().min(1), type: z.literal('stream.connected'), data: z.object({ revalidate: z.literal(true), resumedFromEventId: z.string().nullable() }) })
])

export const apiValidationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string()
})

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    issues: z.array(apiValidationIssueSchema).optional()
  })
})

export const apiContract = {
  info: {
    method: 'GET',
    path: apiPrefix,
    request: apiInfoRequestSchema,
    response: apiInfoResponseSchema
  },
  events: {
    method: 'GET',
    path: `${apiPrefix}/events`
  },
  syncStatus: {
    method: 'GET',
    path: `${apiPrefix}/sync/status`,
    response: syncStatusEventSchema
  },
  displayChoreCompletion: {
    path: `${apiPrefix}/display/chores/:choreId/completion`,
    completeMethod: 'POST',
    undoMethod: 'DELETE',
    request: displayChoreCommandRequestSchema,
    response: displayChoreCommandResponseSchema
  }
} as const

export type ApiInfoResponse = z.infer<typeof apiInfoResponseSchema>
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>
export type ApiValidationIssue = z.infer<typeof apiValidationIssueSchema>
export type EventStreamPrincipal = z.infer<typeof eventStreamPrincipalSchema>
export type ServerEvent = z.infer<typeof serverEventSchema>
export type CelebrationEvent = z.infer<typeof celebrationEventSchema>
export type SyncStatus = z.infer<typeof syncStatusEventSchema>
export type DisplayDevice = z.infer<typeof displayDeviceSchema>
export type RegisteredDisplay = z.infer<typeof registeredDisplaySchema>
export type PersonDto = z.infer<typeof personSchema>
export type GoogleAccountDto = z.infer<typeof googleAccountSchema>
export type DiscoveredCalendarDto = z.infer<typeof discoveredCalendarSchema>
export type ListAdminDto = z.infer<typeof listSchema>
export type MealSlotAdminDto = z.infer<typeof mealSlotSchema>
