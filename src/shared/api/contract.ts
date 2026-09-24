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

/** A paired parent phone. It carries none of a display's kiosk state, and its
 * credential is parent-level, so it appears only in the pairing response. */
export const parentDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pairedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable()
})
export const pairParentDeviceRequestSchema = z.object({
  pin: z.string().min(1),
  name: z.string().min(1).max(120)
}).strict()
export const pairedParentDeviceSchema = parentDeviceSchema.extend({ credential: z.string().min(1) })

/**
 * Screen-initiated enrolment (ADR 0006). The minting response is the only place
 * `pollToken` ever appears: it is what proves a caller is the screen that asked
 * to be adopted, so it is never rendered, never in the QR, and never in a URL.
 * `code` is the opposite — it is shown on a wall and is public by construction.
 */
export const enrolmentCodeSchema = z.object({
  code: z.string().min(1).max(32),
  pollToken: z.string().min(1),
  expiresAt: z.string().datetime()
}).strict()

export const claimEnrolmentRequestSchema = z.object({ pollToken: z.string().min(1).max(400) }).strict()

/** `adopted` carries the credential exactly once; a repeat claim reports `expired`. */
export const claimEnrolmentResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }).strict(),
  z.object({ status: z.literal('expired') }).strict(),
  z.object({ status: z.literal('adopted'), credential: z.string().min(1), display: displayDeviceSchema }).strict()
])

/** Redeemed by a parent's phone after scanning. The code is normalised server-side. */
export const enrolDisplayRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(120)
}).strict()

/** A display may submit a date, but the server compares it to household today. */
export const displayChoreCommandRequestSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be an ISO calendar date')
}).strict()

export const displayChoreCommandResponseSchema = z.object({
  completionId: z.string(),
  balance: z.number().int(),
  created: z.boolean()
})

/** Parent-admin people and calendar configuration DTOs. */
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

/** A connected calendar provider: a CalDAV account, ICS feed, or phone. */
export const calendarSourceKindSchema = z.enum(['caldav', 'ics', 'phone'])
export const calendarSourceSchema = z.object({
  id: z.string().min(1),
  kind: calendarSourceKindSchema,
  name: z.string().min(1),
  connectedAt: z.string().datetime(),
  lastSucceededAt: z.string().datetime().nullable(),
  error: z.string().nullable()
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
export const connectCalDavRequestSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url().max(2000),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1000)
}).strict()
export const connectIcsRequestSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().max(2000)
}).strict()
/** A phone source has no address and no credential: the phone pushes to us. */
export const connectPhoneRequestSchema = z.object({
  name: z.string().min(1).max(120)
}).strict()

/**
 * One occurrence-bearing event read from a phone's own calendar store. It is
 * deliberately the shape the cache already holds rather than an iCalendar
 * document, so no platform has to serialise VEVENTs to talk to us.
 *
 * Two fields carry rules a client cannot guess:
 * - `recurringEventId` is the *master's* `sourceEventId`, not its UID. The
 *   cache resolves exceptions to masters through that identity, so an
 *   exception whose master is absent or differently keyed is silently dropped.
 * - `recurrenceExdates`/`recurrenceRdates` are ISO instants, not local dates;
 *   they are compared against expanded occurrence starts.
 */
const phoneTimestampSchema = z.string().datetime({ offset: true })
export const phoneEventSchema = z.object({
  sourceEventId: z.string().min(1).max(512),
  icalUid: z.string().min(1).max(512).nullish(),
  title: z.string().max(1000),
  description: z.string().max(20_000).nullish(),
  location: z.string().max(1000).nullish(),
  startAt: phoneTimestampSchema,
  endAt: phoneTimestampSchema,
  timezone: z.string().min(1).max(100),
  allDay: z.boolean(),
  recurrence: z.string().max(2000).nullish(),
  recurrenceExdates: z.array(phoneTimestampSchema).max(500).nullish(),
  recurrenceRdates: z.array(phoneTimestampSchema).max(500).nullish(),
  recurringEventId: z.string().max(512).nullish(),
  originalStartAt: phoneTimestampSchema.nullish(),
  status: z.enum(['confirmed', 'cancelled']),
  remoteUpdatedAt: phoneTimestampSchema.nullish()
}).strict()

/**
 * A full-window snapshot of the calendars a phone holds. Full, not
 * incremental: anything absent from a calendar's list is reconciled away, which
 * is the only way a cancelled event reliably leaves the wall.
 */
export const pushPhoneCalendarsRequestSchema = z.object({
  pushedAt: phoneTimestampSchema,
  window: z.object({ start: phoneTimestampSchema, end: phoneTimestampSchema })
    .strict()
    .refine(({ start, end }) => Date.parse(start) < Date.parse(end), { message: 'window.end must be after window.start' }),
  calendars: z.array(z.object({
    sourceCalendarId: z.string().min(1).max(512),
    name: z.string().min(1).max(200),
    color: z.string().min(1).max(40).optional(),
    events: z.array(phoneEventSchema).max(5000)
  }).strict()).max(50)
}).strict()

export const pushPhoneCalendarsResponseSchema = z.object({
  calendars: z.array(z.object({
    sourceCalendarId: z.string().min(1),
    /** False means the parent has not chosen this calendar; stop uploading it. */
    selected: z.boolean(),
    committed: z.number().int().nonnegative(),
    lastPushedAt: z.string().datetime({ offset: true })
  }))
})

/** The server's own view of what it last accepted, so a skewed phone clock can
 * correct itself instead of silently losing every push it makes. */
export const pushPhoneCalendarsConflictSchema = z.object({
  error: z.object({ code: z.literal('conflict'), message: z.string() }),
  stale: z.array(z.object({
    sourceCalendarId: z.string().min(1),
    lastPushedAt: z.string().datetime({ offset: true })
  }))
})
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
  state: z.enum(['not_configured', 'never_synced', 'fresh', 'stale', 'syncing', 'failed', 'idle', 'healthy', 'error']),
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
export type ParentDeviceDto = z.infer<typeof parentDeviceSchema>
export type PairedParentDeviceDto = z.infer<typeof pairedParentDeviceSchema>
export type PairParentDeviceRequest = z.infer<typeof pairParentDeviceRequestSchema>
export type EnrolmentCode = z.infer<typeof enrolmentCodeSchema>
export type ClaimEnrolmentRequest = z.infer<typeof claimEnrolmentRequestSchema>
export type ClaimEnrolmentResponse = z.infer<typeof claimEnrolmentResponseSchema>
export type EnrolDisplayRequest = z.infer<typeof enrolDisplayRequestSchema>
export type PersonDto = z.infer<typeof personSchema>
export type CalendarSourceDto = z.infer<typeof calendarSourceSchema>
export type DiscoveredCalendarDto = z.infer<typeof discoveredCalendarSchema>
export type PhoneEventDto = z.infer<typeof phoneEventSchema>
export type PushPhoneCalendarsRequest = z.infer<typeof pushPhoneCalendarsRequestSchema>
export type PushPhoneCalendarsResponse = z.infer<typeof pushPhoneCalendarsResponseSchema>
export type ListAdminDto = z.infer<typeof listSchema>
export type MealSlotAdminDto = z.infer<typeof mealSlotSchema>
