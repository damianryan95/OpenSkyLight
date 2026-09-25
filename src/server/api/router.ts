import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { ackEventWritesRequestSchema, ackEventWritesResponseSchema, addListItemRequestSchema, authoredEventSchema, eventDraftSchema, eventScopeSchema, updateEventRequestSchema, apiContract, apiInfoResponseSchema, choreCorrectionRequestSchema, claimEnrolmentRequestSchema, claimEnrolmentResponseSchema, connectCalDavRequestSchema, connectIcsRequestSchema, connectPhoneRequestSchema, displayDeviceSchema, enrolDisplayRequestSchema, enrolmentCodeSchema, pendingEventWritesResponseSchema, pushPhoneCalendarsConflictSchema, pushPhoneCalendarsRequestSchema, pushPhoneCalendarsResponseSchema, setCalendarSelectionRequestSchema, createChoreRequestSchema, createListRequestSchema, createPersonRequestSchema, createRewardRequestSchema, displayChoreCommandRequestSchema, mealRangeRequestSchema, mealSlotKindSchema, pairParentDeviceRequestSchema, redeemRewardRequestSchema, registerDisplayRequestSchema, setMealRequestSchema, setMealTemplateRequestSchema, starAdjustmentRequestSchema, updateChoreRequestSchema, updateDisplayRequestSchema, updateHouseholdSettingsRequestSchema, updateListRequestSchema, updatePersonRequestSchema, updateRewardRequestSchema } from '../../shared/api/contract'
import { AuthError, CSRF_HEADER, DisplayDeviceService, DisplayEnrolmentService, HouseholdAuthService, ParentDeviceService, PARENT_SESSION_COOKIE } from '../auth'
import { type ChoresRewardsService, type DisplayReadService, type HouseholdSettingsService, type ListsDomain, type MealsDomain, type PeopleService, type MediaService } from '../domain'
import { createReadStream } from 'node:fs'
import type { EventStream, EventStreamAuthenticator } from '../events'
import type { CalendarSyncStatusService } from '../sync/status'
import type { CalendarSourceService } from '../sync/sources'
import type { SyncScheduler } from '../sync/scheduler'
import type { OnlineIconSearchService } from '../icons'
import type { RssService } from '../domain/rss'
import type { EventAuthoringService } from '../domain/events'
import type { PhoneWriteService } from '../sync/phoneWrites'
import { ApiRequestError, readBinaryBody, readJsonBody, sendApiError, sendJson, validateApiInput } from './http'

export interface ApiRouterDependencies {
  eventStream?: EventStream
  eventStreamAuthenticator?: EventStreamAuthenticator
  auth?: HouseholdAuthService
  displays?: DisplayDeviceService
  displayEnrolment?: DisplayEnrolmentService
  parentDevices?: ParentDeviceService
  chores?: ChoresRewardsService
  settings?: HouseholdSettingsService
  people?: PeopleService
  syncStatus?: CalendarSyncStatusService
  calendarSources?: CalendarSourceService
  syncScheduler?: SyncScheduler
  displayRead?: DisplayReadService
  lists?: ListsDomain
  meals?: MealsDomain
  icons?: OnlineIconSearchService
  media?: MediaService
  rss?: RssService
  /** Event authoring (ADR 0007). Absent leaves the board read-only, which is
   * exactly how every display behaved before `N15`. */
  eventAuthoring?: EventAuthoringService
  /** The outbound queue a phone drains. */
  phoneWrites?: PhoneWriteService
  /** Injectable clock for household-date authorization tests. */
  now?: () => Date
}

const pinRequestSchema = z.object({ pin: z.string() }).strict()
const changePinRequestSchema = z.object({ newPin: z.string() }).strict()
const connectCalendarSourceRequestSchema = z.discriminatedUnion('kind', [
  connectCalDavRequestSchema.extend({ kind: z.literal('caldav') }),
  connectIcsRequestSchema.extend({ kind: z.literal('ics') }),
  connectPhoneRequestSchema.extend({ kind: z.literal('phone') })
])

function requireParentDevices(dependencies: ApiRouterDependencies): ParentDeviceService {
  if (dependencies.parentDevices === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Phone pairing is unavailable')
  return dependencies.parentDevices
}

function requireSources(dependencies: ApiRouterDependencies): CalendarSourceService {
  if (dependencies.calendarSources === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Calendar sources are unavailable')
  return dependencies.calendarSources
}

function requirePhoneWrites(dependencies: ApiRouterDependencies): PhoneWriteService {
  if (dependencies.phoneWrites === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Calendar write-back is unavailable')
  return dependencies.phoneWrites
}

function requireEventAuthoring(dependencies: ApiRouterDependencies): EventAuthoringService {
  if (dependencies.eventAuthoring === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Event editing is unavailable')
  return dependencies.eventAuthoring
}


export async function handleApiRequest(request: IncomingMessage, response: ServerResponse, dependencies: ApiRouterDependencies = {}): Promise<boolean> {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (!path.startsWith('/api/')) return false

  try {
    const auth = dependencies.auth
    const displays = dependencies.displays
    const rpcMatch = /^\/api\/rpc\/([^/]+)$/.exec(path)
    if (rpcMatch !== null) {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      if (auth === undefined || displays === undefined || dependencies.displayRead === undefined || dependencies.people === undefined || dependencies.lists === undefined || dependencies.meals === undefined || dependencies.chores === undefined || dependencies.settings === undefined) {
        throw new ApiRequestError(503, 'service_unavailable', 'Display read services are unavailable')
      }
      const device = displays.authenticate(readBearerToken(request))
      if (device === undefined) throw new AuthError(401, 'unauthorized', 'A registered display credential is required')
      const channel = decodeURIComponent(rpcMatch[1])
      const result = await handleDisplayReadRpc(channel, request, device, dependencies as Required<Pick<ApiRouterDependencies, 'auth' | 'displays' | 'displayRead' | 'people' | 'lists' | 'meals' | 'chores' | 'settings'>> & ApiRouterDependencies)
      sendJson(response, 200, { ok: true, data: result })
      return true
    }
    if (path === apiContract.syncStatus.path) {
      if (method !== apiContract.syncStatus.method) throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      if (dependencies.syncStatus === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Calendar sync status is unavailable')
      sendJson(response, 200, apiContract.syncStatus.response.parse(dependencies.syncStatus.get()))
      return true
    }
    if (path.startsWith('/api/v1/auth/') && auth === undefined) {
      throw new ApiRequestError(503, 'service_unavailable', 'Authentication service is unavailable')
    }

    if (path === '/api/v1/auth/status') {
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      // Deliberately never throws on a bad credential. This is the endpoint a
      // client asks before it knows whether it is signed in, so a revoked app
      // must learn it needs to pair again rather than get a 401 it cannot act
      // on. A bearer has no expiry to report; the cookie session does.
      const paired = readHeader(request, 'authorization') === undefined
        ? undefined
        : dependencies.parentDevices?.authenticate(readBearerToken(request))
      const session = paired !== undefined ? undefined : auth?.getParentSession(readCookie(request, PARENT_SESSION_COOKIE))
      sendJson(response, 200, {
        configured: auth?.isConfigured() ?? false,
        authenticated: paired !== undefined || session !== undefined,
        expiresAt: session?.expiresAt ?? null
      })
      return true
    }

    if (path === '/api/v1/auth/setup' || path === '/api/v1/auth/login') {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      assertSameOrigin(request)
      const { pin } = await readJsonBody(request, pinRequestSchema)
      const session = path.endsWith('/setup') ? auth!.setup(pin) : auth!.login(pin)
      setParentSessionCookie(response, request, session.sessionToken, session.expiresAt)
      sendJson(response, path.endsWith('/setup') ? 201 : 200, { csrfToken: session.csrfToken, expiresAt: session.expiresAt })
      return true
    }

    if (path === '/api/v1/auth/logout') {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      assertSameOrigin(request)
      const token = readCookie(request, PARENT_SESSION_COOKIE)
      auth!.requireParentMutation(token, readHeader(request, CSRF_HEADER))
      auth!.logout(token)
      clearParentSessionCookie(response, request)
      response.writeHead(204)
      response.end()
      return true
    }

    if (path === '/api/v1/auth/pin') {
      if (method !== 'PUT') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      assertSameOrigin(request)
      const { newPin } = await readJsonBody(request, changePinRequestSchema)
      auth!.changePin(readCookie(request, PARENT_SESSION_COOKIE), readHeader(request, CSRF_HEADER), newPin)
      clearParentSessionCookie(response, request)
      response.writeHead(204)
      response.end()
      return true
    }

    if (path === '/api/v1/household/settings') {
      if (dependencies.settings === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Household settings are unavailable')
      if (method === 'GET') { requireParentRead(dependencies, request); sendJson(response, 200, dependencies.settings.get()); return true }
      if (method === 'PATCH') {
        requireParentMutation(dependencies, request)
        const input = await readJsonBody(request, updateHouseholdSettingsRequestSchema)
        if (input.timezone !== undefined) dependencies.settings.setTimezone(input.timezone)
        const settings = input.weather === undefined ? dependencies.settings.get() : dependencies.settings.setWeather(input.weather)
        sendJson(response, 200, settings)
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    if (path === '/api/v1/weather/locations') {
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentRead(dependencies, request)
      sendJson(response, 200, { locations: await searchWeatherLocations(url.searchParams.get('q') ?? '') })
      return true
    }

    if (path === '/api/v1/people') {
      if (dependencies.people === undefined) throw new ApiRequestError(503, 'service_unavailable', 'People service is unavailable')
      if (method === 'GET') {
        requireParentRead(dependencies, request)
        sendJson(response, 200, { people: dependencies.people.list() })
        return true
      }
      if (method === 'POST') {
        requireParentMutation(dependencies, request)
        sendJson(response, 201, dependencies.people.create(await readJsonBody(request, createPersonRequestSchema)))
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    if (path === '/api/v1/media/celebrations') {
      if (dependencies.media === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Celebration media is unavailable')
      if (method === 'GET') { requireParentRead(dependencies, request); sendJson(response, 200, { assets: dependencies.media.list() }); return true }
      if (method === 'POST') { requireParentMutation(dependencies, request); const asset = await dependencies.media.upload({ bytes: await readBinaryBody(request), contentType: readHeader(request, 'content-type'), originalName: readHeader(request, 'x-osl-file-name') }); sendJson(response, 201, asset); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    if (path === '/api/v1/media/photos') {
      if (dependencies.media === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Photo media is unavailable')
      if (method === 'GET') { requireParentRead(dependencies, request); sendJson(response, 200, { assets: dependencies.media.listPhotos() }); return true }
      if (method === 'POST') {
        requireParentMutation(dependencies, request)
        const asset = await dependencies.media.upload({ bytes: await readBinaryBody(request), contentType: readHeader(request, 'content-type'), originalName: readHeader(request, 'x-osl-file-name'), kind: 'photo' })
        sendJson(response, 201, asset)
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const parentPhotoMatch = /^\/api\/v1\/media\/photos\/([^/]+)(?:\/(content))?$/.exec(path)
    if (parentPhotoMatch !== null) {
      if (dependencies.media === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Photo media is unavailable')
      const id = decodeURIComponent(parentPhotoMatch[1]); const content = parentPhotoMatch[2]
      if (content === 'content' && method === 'GET') { requireParentRead(dependencies, request); return sendMedia(response, dependencies.media.file(id)) }
      if (content === undefined && method === 'DELETE') { requireParentMutation(dependencies, request); await dependencies.media.remove(id); response.writeHead(204); response.end(); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const parentMediaMatch = /^\/api\/v1\/media\/celebrations\/([^/]+)(?:\/(content))?$/.exec(path)
    if (parentMediaMatch !== null) {
      if (dependencies.media === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Celebration media is unavailable')
      const id = decodeURIComponent(parentMediaMatch[1]); const content = parentMediaMatch[2]
      if (content === 'content' && method === 'GET') { requireParentRead(dependencies, request); return sendMedia(response, dependencies.media.file(id)) }
      if (content === undefined && method === 'DELETE') { requireParentMutation(dependencies, request); await dependencies.media.remove(id); response.writeHead(204); response.end(); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const displayMediaMatch = /^\/api\/v1\/display\/media\/([^/]+)$/.exec(path)
    if (displayMediaMatch !== null) {
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      if (dependencies.media === undefined || displays === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Celebration media is unavailable')
      if (displays.authenticate(readBearerToken(request)) === undefined) throw new AuthError(401, 'unauthorized', 'A registered display credential is required')
      return sendMedia(response, dependencies.media.assignedFile(decodeURIComponent(displayMediaMatch[1])))
    }

    const personMatch = /^\/api\/v1\/people\/([^/]+)$/.exec(path)
    if (personMatch !== null) {
      if (dependencies.people === undefined) throw new ApiRequestError(503, 'service_unavailable', 'People service is unavailable')
      const id = decodeURIComponent(personMatch[1])
      if (method === 'PATCH') {
        requireParentMutation(dependencies, request)
        sendJson(response, 200, dependencies.people.update({ id, ...await readJsonBody(request, updatePersonRequestSchema) }))
        return true
      }
      if (method === 'DELETE') {
        requireParentMutation(dependencies, request)
        dependencies.people.remove(id)
        response.writeHead(204)
        response.end()
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    if (path === '/api/v1/chores') {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Chore service is unavailable')
      if (method === 'GET') { requireParentRead(dependencies, request); sendJson(response, 200, { chores: dependencies.chores.listChores() }); return true }
      if (method === 'POST') { requireParentMutation(dependencies, request); const id = dependencies.chores.createChore(await readJsonBody(request, createChoreRequestSchema)); sendJson(response, 201, dependencies.chores.listChores().find((chore) => chore.id === id)!); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    if (path === '/api/v1/icons/search') {
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentRead(dependencies, request)
      if (dependencies.icons === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Online icon search is unavailable')
      const query = url.searchParams.get('query')?.trim() ?? ''
      if (query.length < 2 || query.length > 80) throw new ApiRequestError(400, 'bad_request', 'Enter at least two characters to search icons')
      try { sendJson(response, 200, { icons: await dependencies.icons.search(query) }) } catch { throw new ApiRequestError(503, 'service_unavailable', 'Icon search is temporarily unavailable') }
      return true
    }
    if (path === '/api/v1/icons/import') {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request)
      if (dependencies.icons === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Online icon search is unavailable')
      const { name, color } = await readJsonBody(request, z.object({ name: z.string().min(1).max(140), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).strict())
      try { sendJson(response, 200, { icon: await dependencies.icons.import(name, color) }) } catch { throw new ApiRequestError(400, 'bad_request', 'That icon could not be imported') }
      return true
    }
    const choreMatch = /^\/api\/v1\/chores\/([^/]+)$/.exec(path)
    if (choreMatch !== null) {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Chore service is unavailable')
      const id = decodeURIComponent(choreMatch[1])
      if (method === 'PATCH') { requireParentMutation(dependencies, request); sendJson(response, 200, dependencies.chores.updateChore({ id, ...await readJsonBody(request, updateChoreRequestSchema) })); return true }
      if (method === 'DELETE') { requireParentMutation(dependencies, request); dependencies.chores.archiveChore(id); response.writeHead(204); response.end(); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const correctionMatch = /^\/api\/v1\/chores\/([^/]+)\/completion$/.exec(path)
    if (correctionMatch !== null) {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Chore service is unavailable')
      requireParentMutation(dependencies, request)
      const { dueDate } = await readJsonBody(request, choreCorrectionRequestSchema)
      const command = { choreId: decodeURIComponent(correctionMatch[1]), dueDate, actor: 'parent' as const }
      sendJson(response, 200, method === 'POST' ? dependencies.chores.complete(command) : method === 'DELETE' ? dependencies.chores.undo(command) : (() => { throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`) })())
      return true
    }
    if (path === '/api/v1/stars/adjustments') {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Chore service is unavailable')
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request)
      const input = await readJsonBody(request, starAdjustmentRequestSchema)
      const balance = dependencies.chores.adjustStars(input)
      // A manual adjustment changes the same display balances as a chore. Let
      // every connected kiosk revalidate immediately instead of waiting for a
      // poll or a later chore completion.
      dependencies.eventStream?.publish({ type: 'query.invalidated', data: { resources: ['chores'] } })
      sendJson(response, 200, { balance })
      return true
    }
    if (path === '/api/v1/rewards') {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Reward service is unavailable')
      if (method === 'GET') { requireParentRead(dependencies, request); sendJson(response, 200, { rewards: dependencies.chores.listRewards() }); return true }
      if (method === 'POST') { requireParentMutation(dependencies, request); const id = dependencies.chores.createReward(await readJsonBody(request, createRewardRequestSchema)); sendJson(response, 201, dependencies.chores.listRewards().find((reward) => reward.id === id)!); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const rewardMatch = /^\/api\/v1\/rewards\/([^/]+)(?:\/(redeem))?$/.exec(path)
    if (rewardMatch !== null) {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Reward service is unavailable')
      const id = decodeURIComponent(rewardMatch[1]); const action = rewardMatch[2]
      if (action === 'redeem' && method === 'POST') { requireParentMutation(dependencies, request); const { personId } = await readJsonBody(request, redeemRewardRequestSchema); sendJson(response, 201, { id: dependencies.chores.redeem(id, personId) }); return true }
      if (!action && method === 'PATCH') { requireParentMutation(dependencies, request); sendJson(response, 200, dependencies.chores.updateReward({ id, ...await readJsonBody(request, updateRewardRequestSchema) })); return true }
      if (!action && method === 'DELETE') { requireParentMutation(dependencies, request); dependencies.chores.archiveReward(id); response.writeHead(204); response.end(); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    if (path === '/api/v1/reward-redemptions') {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Reward service is unavailable')
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentRead(dependencies, request); sendJson(response, 200, { redemptions: dependencies.chores.listRedemptions() }); return true
    }
    const grantMatch = /^\/api\/v1\/reward-redemptions\/([^/]+)\/grant$/.exec(path)
    if (grantMatch !== null) {
      if (dependencies.chores === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Reward service is unavailable')
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request); dependencies.chores.grantRedemption(decodeURIComponent(grantMatch[1])); response.writeHead(204); response.end(); return true
    }

    if (path === '/api/v1/lists') {
      if (dependencies.lists === undefined) throw new ApiRequestError(503, 'service_unavailable', 'List service is unavailable')
      if (method === 'GET') { requireParentRead(dependencies, request); sendJson(response, 200, { lists: dependencies.lists.queries.getAll() }); return true }
      if (method === 'POST') {
        requireParentMutation(dependencies, request)
        const list = dependencies.lists.parentCommands.create(await readJsonBody(request, createListRequestSchema))
        publishInvalidation(dependencies, ['lists'])
        sendJson(response, 201, list)
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const listItemsMatch = /^\/api\/v1\/lists\/([^/]+)\/items(?:\/(checked))?$/.exec(path)
    if (listItemsMatch !== null) {
      if (dependencies.lists === undefined) throw new ApiRequestError(503, 'service_unavailable', 'List service is unavailable')
      const listId = decodeURIComponent(listItemsMatch[1]); const action = listItemsMatch[2]
      if (action === undefined && method === 'POST') {
        requireParentMutation(dependencies, request)
        const item = dependencies.lists.parentCommands.addItem(listId, (await readJsonBody(request, addListItemRequestSchema)).text)
        publishInvalidation(dependencies, ['lists'])
        sendJson(response, 201, item)
        return true
      }
      if (action === 'checked' && method === 'DELETE') {
        requireParentMutation(dependencies, request); dependencies.lists.parentCommands.clearChecked(listId); publishInvalidation(dependencies, ['lists']); response.writeHead(204); response.end(); return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const listMatch = /^\/api\/v1\/lists\/([^/]+)$/.exec(path)
    if (listMatch !== null) {
      if (dependencies.lists === undefined) throw new ApiRequestError(503, 'service_unavailable', 'List service is unavailable')
      const id = decodeURIComponent(listMatch[1])
      if (method === 'PATCH') { requireParentMutation(dependencies, request); const list = dependencies.lists.parentCommands.update({ id, ...await readJsonBody(request, updateListRequestSchema) }); publishInvalidation(dependencies, ['lists']); sendJson(response, 200, list); return true }
      if (method === 'DELETE') { requireParentMutation(dependencies, request); dependencies.lists.parentCommands.remove(id); publishInvalidation(dependencies, ['lists']); response.writeHead(204); response.end(); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }
    const listItemMatch = /^\/api\/v1\/list-items\/([^/]+)(?:\/(toggle))?$/.exec(path)
    if (listItemMatch !== null) {
      if (dependencies.lists === undefined) throw new ApiRequestError(503, 'service_unavailable', 'List service is unavailable')
      const id = decodeURIComponent(listItemMatch[1]); const action = listItemMatch[2]
      if (action === 'toggle' && method === 'POST') { requireParentMutation(dependencies, request); dependencies.lists.parentCommands.toggleItem(id); publishInvalidation(dependencies, ['lists']); response.writeHead(204); response.end(); return true }
      if (action === undefined && method === 'DELETE') { requireParentMutation(dependencies, request); dependencies.lists.parentCommands.removeItem(id); publishInvalidation(dependencies, ['lists']); response.writeHead(204); response.end(); return true }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    if (path === '/api/v1/meals') {
      if (dependencies.meals === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Meal service is unavailable')
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentRead(dependencies, request)
      const { start, end } = validateApiInput(Object.fromEntries(url.searchParams), mealRangeRequestSchema)
      sendJson(response, 200, { meals: dependencies.meals.queries.getRange(start, end) })
      return true
    }
    if (path === '/api/v1/meal-templates') {
      if (dependencies.meals === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Meal service is unavailable')
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentRead(dependencies, request); sendJson(response, 200, { templates: dependencies.meals.queries.getTemplates() }); return true
    }
    const mealTemplateMatch = /^\/api\/v1\/meal-templates\/([1-7])\/(breakfast|lunch|dinner)$/.exec(path)
    if (mealTemplateMatch !== null) {
      if (dependencies.meals === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Meal service is unavailable')
      if (method !== 'PUT') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request); dependencies.meals.parentCommands.setTemplate(Number(mealTemplateMatch[1]), mealSlotKindSchema.parse(mealTemplateMatch[2]), (await readJsonBody(request, setMealTemplateRequestSchema)).text); response.writeHead(204); response.end(); return true
    }
    const mealMatch = /^\/api\/v1\/meals\/(\d{4}-\d{2}-\d{2})\/(breakfast|lunch|dinner)$/.exec(path)
    if (mealMatch !== null) {
      if (dependencies.meals === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Meal service is unavailable')
      if (method !== 'PUT') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request)
      const date = mealMatch[1]; const slot = mealSlotKindSchema.parse(mealMatch[2]); const { text } = await readJsonBody(request, setMealRequestSchema)
      dependencies.meals.parentCommands.set(date, slot, text)
      publishInvalidation(dependencies, ['meals'])
      response.writeHead(204); response.end(); return true
    }

    // Authoring events (ADR 0007). Parent-gated like every other mutation; the
    // wall display reaches the same service through its own PIN-bounded RPC.
    //
    // `/api/v1/calendar-events` rather than `/api/v1/events`, which is already
    // the server-sent event stream. Two different things called "events" is the
    // repo's own naming, and this is the boundary where it would silently bite.
    if (path === '/api/v1/calendar-events') {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request)
      const created = requireEventAuthoring(dependencies).create(await readJsonBody(request, eventDraftSchema))
      publishInvalidation(dependencies, ['events'])
      sendJson(response, 201, authoredEventSchema.parse(created))
      return true
    }

    const eventMatch = /^\/api\/v1\/calendar-events\/([^/]+)$/.exec(path)
    if (eventMatch !== null) {
      requireParentMutation(dependencies, request)
      const events = requireEventAuthoring(dependencies)
      const eventId = decodeURIComponent(eventMatch[1])
      // Which of a series is meant travels in the query string rather than the
      // body, because a delete has no body to put it in and the two operations
      // must not disagree about how to say the same thing.
      const url = new URL(request.url ?? '/', 'http://localhost')
      const scope = eventScopeSchema.catch('series').parse(url.searchParams.get('scope') ?? 'series')
      const occurrenceStart = url.searchParams.get('occurrenceStart')
      if (scope === 'occurrence' && occurrenceStart === null) {
        throw new ApiRequestError(400, 'bad_request', 'Editing one occurrence needs the occurrence it means')
      }

      if (method === 'PATCH') {
        const patch = await readJsonBody(request, updateEventRequestSchema)
        const result = scope === 'occurrence'
          ? events.updateOccurrence(eventId, occurrenceStart!, patch)
          : events.update(eventId, patch)
        publishInvalidation(dependencies, ['events'])
        sendJson(response, 200, authoredEventSchema.parse(result))
        return true
      }
      if (method === 'DELETE') {
        if (scope === 'occurrence') events.removeOccurrence(eventId, occurrenceStart!)
        else events.remove(eventId)
        publishInvalidation(dependencies, ['events'])
        response.writeHead(204); response.end(); return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    if (path === '/api/v1/calendar-sources') {
      const sources = requireSources(dependencies)
      if (method === 'GET') { requireParentRead(dependencies, request); sendJson(response, 200, { sources: sources.list() }); return true }
      if (method === 'POST') {
        requireParentMutation(dependencies, request)
        const input = await readJsonBody(request, connectCalendarSourceRequestSchema)
        const source = input.kind === 'ics'
          ? await sources.connectIcs({ name: input.name, url: input.url })
          : input.kind === 'phone'
            ? sources.connectPhone({ name: input.name })
            : await sources.connectCalDav({ name: input.name, baseUrl: input.baseUrl, username: input.username, password: input.password })
        if (input.kind === 'ics') void dependencies.syncScheduler?.syncNow()
        sendJson(response, 201, source)
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    if (path === '/api/v1/calendar-sources/sync') {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request)
      const sources = requireSources(dependencies)
      if (dependencies.syncScheduler === undefined) { void sources.syncAll() } else { void dependencies.syncScheduler.syncNow() }
      response.writeHead(202); response.end(); return true
    }

    const sourceMatch = /^\/api\/v1\/calendar-sources\/([^/]+)(?:\/(calendars|push|pending-writes|pending-writes\/ack))?$/.exec(path)
    if (sourceMatch !== null) {
      const sources = requireSources(dependencies)
      const sourceId = decodeURIComponent(sourceMatch[1])
      const calendars = sourceMatch[2] === 'calendars'

      // Write-back to a phone, which runs the opposite way round: the phone asks
      // what is outstanding and applies it itself (ADR 0007).
      if (sourceMatch[2] === 'pending-writes' && method === 'GET') {
        requireParentRead(dependencies, request)
        const phoneWrites = requirePhoneWrites(dependencies)
        sendJson(response, 200, pendingEventWritesResponseSchema.parse({ writes: phoneWrites.pending(sourceId) }))
        return true
      }
      if (sourceMatch[2] === 'pending-writes/ack' && method === 'POST') {
        requireParentMutation(dependencies, request)
        const phoneWrites = requirePhoneWrites(dependencies)
        const input = await readJsonBody(request, ackEventWritesRequestSchema)
        const result = phoneWrites.acknowledge(sourceId, input)
        // An applied write changes what the board shows, because the mirror it
        // records is what stops the pushed-back copy appearing twice.
        if (result.applied > 0) publishInvalidation(dependencies, ['events'])
        sendJson(response, 200, ackEventWritesResponseSchema.parse(result))
        return true
      }
      if (sourceMatch[2] === 'push' && method === 'POST') {
        // Parent-authenticated like every other mutation; the paired app
        // reaches it over the bearer path. The payload is never logged: it is
        // the household's calendar in full.
        requireParentMutation(dependencies, request)
        const result = sources.pushPhoneCalendars(sourceId, await readJsonBody(request, pushPhoneCalendarsRequestSchema))
        if (!result.applied) {
          sendJson(response, 409, pushPhoneCalendarsConflictSchema.parse({
            error: { code: 'conflict', message: 'A newer snapshot has already been applied for this phone. Push again with a current timestamp.' },
            stale: result.stale
          }))
          return true
        }
        sendJson(response, 200, pushPhoneCalendarsResponseSchema.parse({ calendars: result.calendars }))
        return true
      }
      if (calendars && method === 'GET') {
        requireParentRead(dependencies, request)
        const discovered = await sources.discoverCollections(sourceId)
        sendJson(response, 200, {
          calendars: discovered.map((collection) => ({
            id: collection.url, name: collection.name, color: collection.color, primary: false,
            readOnly: collection.readOnly, selected: collection.selected, audiencePersonId: collection.audiencePersonId
          }))
        })
        return true
      }
      if (calendars && method === 'PUT') {
        requireParentMutation(dependencies, request)
        const input = await readJsonBody(request, setCalendarSelectionRequestSchema)
        sources.setCalendarSelection({
          sourceId, url: input.calendar.id, name: input.calendar.name, color: input.calendar.color,
          selected: input.selected, audiencePersonId: input.audiencePersonId, readOnly: input.calendar.readOnly
        })
        if (input.selected) void dependencies.syncScheduler?.syncNow()
        publishInvalidation(dependencies, ['events'])
        response.writeHead(204); response.end(); return true
      }
      if (sourceMatch[2] === undefined && method === 'DELETE') {
        requireParentMutation(dependencies, request)
        sources.remove(sourceId)
        publishInvalidation(dependencies, ['events'])
        response.writeHead(204); response.end(); return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    // Screen-initiated enrolment (ADR 0006). Kept ahead of `/api/v1/displays/:id`
    // so `enrol` is not read as a display id.
    if (path === '/api/v1/display/enrolment-code' || path === '/api/v1/display/enrolment-code/claim' || path === '/api/v1/displays/enrol') {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      if (dependencies.displayEnrolment === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Display enrolment is unavailable')
      const enrolment = dependencies.displayEnrolment
      // JSON is demanded for the same reason phone pairing demands it: it denies
      // a hostile page the CORS-simple request that would otherwise let it drive
      // these endpoints from a browser with no preflight.
      assertJsonContentType(request)

      if (path === '/api/v1/display/enrolment-code') {
        // Deliberately unauthenticated. This is the one display-initiated write
        // channel K03 permits, and ADR 0006 rules on it explicitly rather than
        // leaving it to be found: it runs before the screen is registered, it
        // writes no household data, and it mints nothing of value on its own.
        // The code is inert until a parent redeems it, and the credential that
        // redemption produces is released only against the poll token, which
        // exists solely in this response. Rate-limited per client address.
        sendJson(response, 201, enrolmentCodeSchema.parse(enrolment.mint(clientAddress(request))))
        return true
      }

      if (path === '/api/v1/display/enrolment-code/claim') {
        // Unauthenticated by necessity — the caller has no credential yet, which
        // is the whole point. The poll token in the *body* is the authentication,
        // and it stays in the body so neither secret ever reaches a query string,
        // an access log or server-rendered history.
        const { pollToken } = await readJsonBody(request, claimEnrolmentRequestSchema)
        sendJson(response, 200, claimEnrolmentResponseSchema.parse(enrolment.claim(pollToken)))
        return true
      }

      // Parent authenticated over either the cookie or the N17 bearer path.
      requireParentMutation(dependencies, request)
      const input = await readJsonBody(request, enrolDisplayRequestSchema)
      // Parsed through the credential-free display schema on purpose: the
      // credential belongs to the screen, collected through claim, and must not
      // reach the phone that adopted it.
      sendJson(response, 201, displayDeviceSchema.parse(enrolment.redeem(input.code, input.name, clientAddress(request))))
      return true
    }

    if (path === '/api/v1/displays') {
      if (method === 'GET') {
        requireParentRead(dependencies, request)
        if (displays === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Display service is unavailable')
        sendJson(response, 200, { displays: displays.list() })
        return true
      }
      if (method === 'POST') {
        requireParentMutation(dependencies, request)
        if (displays === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Display service is unavailable')
        const input = await readJsonBody(request, registerDisplayRequestSchema)
        // The credential is intentionally present only in this parent-approved response.
        sendJson(response, 201, displays.register(input))
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    const displayMatch = /^\/api\/v1\/displays\/([^/]+)(?:\/(revoke))?$/.exec(path)
    if (displayMatch !== null) {
      const [, displayId, action] = displayMatch
      if (action === 'revoke') {
        if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
        requireParentMutation(dependencies, request)
        if (displays === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Display service is unavailable')
        displays.revoke(displayId)
        response.writeHead(204)
        response.end()
        return true
      }
      if (method !== 'PATCH') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      requireParentMutation(dependencies, request)
      if (displays === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Display service is unavailable')
      sendJson(response, 200, displays.update(displayId, await readJsonBody(request, updateDisplayRequestSchema)))
      return true
    }

    if (path === '/api/v1/parent-devices') {
      if (method === 'POST') {
        if (auth === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Authentication service is unavailable')
        const parentDevices = requireParentDevices(dependencies)
        // No cookie and no origin check: the caller pairing a phone is by
        // definition at a foreign origin with no session yet. The household
        // PIN is the parent authorisation, and it is checked through the
        // ordinary login path so a wrong PIN feeds the same failure counter
        // and backoff the PIN screen uses — a parent-level credential must not
        // be a cheaper brute-force target than the PIN itself. The session
        // that check mints is discarded immediately; pairing issues a bearer
        // credential, never a browser session.
        assertJsonContentType(request)
        const { pin, name } = await readJsonBody(request, pairParentDeviceRequestSchema)
        const session = auth.login(pin)
        auth.logout(session.sessionToken)
        // The credential is intentionally present only in this response.
        sendJson(response, 201, parentDevices.pair({ name }))
        return true
      }
      if (method === 'GET') {
        requireParentRead(dependencies, request)
        sendJson(response, 200, { parentDevices: requireParentDevices(dependencies).list() })
        return true
      }
      throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
    }

    const parentDeviceRevokeMatch = /^\/api\/v1\/parent-devices\/([^/]+)\/revoke$/.exec(path)
    if (parentDeviceRevokeMatch !== null) {
      if (method !== 'POST') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      // Deliberately reachable over the bearer path too: a parent whose phone
      // is lost has only their other phone to kill it from.
      requireParentMutation(dependencies, request)
      requireParentDevices(dependencies).revoke(decodeURIComponent(parentDeviceRevokeMatch[1]))
      response.writeHead(204)
      response.end()
      return true
    }

    if (path === '/api/v1/display/session') {
      if (method !== 'GET') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      if (displays === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Display service is unavailable')
      const device = displays.authenticate(readBearerToken(request))
      if (device === undefined) throw new AuthError(401, 'unauthorized', 'A registered display credential is required')
      sendJson(response, 200, { display: device })
      return true
    }

    const displayChoreMatch = /^\/api\/v1\/display\/chores\/([^/]+)\/completion$/.exec(path)
    if (displayChoreMatch !== null) {
      if (method !== 'POST' && method !== 'DELETE') throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      if (displays === undefined || dependencies.chores === undefined || dependencies.settings === undefined) {
        throw new ApiRequestError(503, 'service_unavailable', 'Display chore service is unavailable')
      }
      const device = displays.authenticate(readBearerToken(request))
      if (device === undefined) throw new AuthError(401, 'unauthorized', 'A registered display credential is required')
      const { dueDate } = await readJsonBody(request, displayChoreCommandRequestSchema)
      const householdDate = currentHouseholdDate(dependencies.settings, dependencies.now)
      const command = {
        choreId: decodeURIComponent(displayChoreMatch[1]),
        dueDate,
        actor: 'display' as const,
        authorizedDate: householdDate,
        initiatingDeviceId: device.id
      }
      const result = method === 'POST' ? dependencies.chores.complete(command) : dependencies.chores.undo(command)
      sendJson(response, 200, result)
      return true
    }

    if (path === apiContract.events.path) {
      if (method !== apiContract.events.method) {
        throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      }
      const principal = dependencies.eventStreamAuthenticator?.authenticate(request)
      if (principal === undefined) {
        throw new ApiRequestError(401, 'unauthorized', 'Authentication is required for the event stream')
      }
      if (dependencies.eventStream === undefined) {
        throw new ApiRequestError(503, 'internal_error', 'Event stream is unavailable')
      }
      const lastEventId = request.headers['last-event-id']
      dependencies.eventStream.connect(response, typeof lastEventId === 'string' ? lastEventId : undefined)
      return true
    }

    if (path === apiContract.info.path) {
      if (method !== apiContract.info.method) {
        throw new ApiRequestError(405, 'method_not_allowed', `Method ${method} is not allowed`)
      }
      validateApiInput(Object.fromEntries(url.searchParams), apiContract.info.request)
      sendJson(response, 200, apiInfoResponseSchema.parse({ version: 'v1' }))
      return true
    }

    throw new ApiRequestError(404, 'not_found', 'API route was not found')
  } catch (error) {
    if (error instanceof ApiRequestError) {
      sendApiError(response, error)
      return true
    }
    if (error instanceof AuthError) {
      if (error.retryAfterSeconds !== undefined) response.setHeader('retry-after', String(error.retryAfterSeconds))
      sendApiError(response, new ApiRequestError(error.status, error.code, error.message))
      return true
    }
    if (error instanceof Error) {
      // Domain validation errors intentionally do not expose storage internals.
      sendApiError(response, new ApiRequestError(400, 'bad_request', error.message))
      return true
    }
    sendApiError(response, new ApiRequestError(500, 'internal_error', 'Unexpected server error'))
    return true
  }
}

/**
 * Temporary compatibility boundary for the protected kiosk renderer.  The
 * whitelist is deliberately read-only except A04's already-authorized today
 * chore completion/undo commands; every other legacy IPC mutation is refused.
 */
async function handleDisplayReadRpc(
  channel: string,
  request: IncomingMessage,
  device: ReturnType<DisplayDeviceService['authenticate']> & object,
  dependencies: Required<Pick<ApiRouterDependencies, 'auth' | 'displays' | 'displayRead' | 'people' | 'lists' | 'meals' | 'chores' | 'settings'>> & ApiRouterDependencies
): Promise<unknown> {
  const read = dependencies.displayRead
  switch (channel) {
    case 'app:getInfo': return {
      version: process.env.OSL_RELEASE_VERSION ?? '0.8.0',
      platform: 'browser',
      zone: dependencies.settings.get().timezone,
      householdDate: currentHouseholdDate(dependencies.settings, dependencies.now)
    }
    case 'settings:getAll': return read.settings(device)
    case 'settings:set': {
      if ((displayEditUntil.get(device.id) ?? 0) < Date.now()) throw new AuthError(403, 'forbidden', 'Enter the parent PIN before changing this display layout')
      const input = await readJsonBody(request, z.object({ patch: z.object({ homeLayout: z.unknown() }).strict() }).strict())
      const updated = dependencies.displays.update(device.id, { homeLayout: input.patch.homeLayout })
      return read.settings(updated)
    }
    case 'people:list': return dependencies.people.list()
    case 'calendars:list': return read.calendars()
    case 'events:getOccurrences': {
      const input = await readJsonBody(request, z.object({ start: z.string(), end: z.string() }).strict())
      return read.occurrences(input)
    }
    case 'events:get': {
      const input = await readJsonBody(request, z.object({ id: z.string().min(1) }).strict())
      return read.event(input.id)
    }
    // N15 narrows K03 for calendar events only, and only inside the PIN-bounded
    // window `auth:verifyPin` opens. Everything else a display might mutate is
    // still refused by the `default` arm below — deliberately, and with tests
    // asserting the narrower boundary rather than the absence of one.
    case 'events:create': {
      requireDisplayEditWindow(device)
      const created = requireEventAuthoring(dependencies).create(await readJsonBody(request, eventDraftSchema))
      publishInvalidation(dependencies, ['events'])
      return created
    }
    case 'events:update': {
      requireDisplayEditWindow(device)
      const input = await readJsonBody(request, displayEventUpdateSchema)
      const events = requireEventAuthoring(dependencies)
      const result = input.scope === 'occurrence'
        ? events.updateOccurrence(input.id, input.occurrenceStart, input.patch)
        : events.update(input.id, input.patch)
      publishInvalidation(dependencies, ['events'])
      return result
    }
    case 'events:delete': {
      requireDisplayEditWindow(device)
      const input = await readJsonBody(request, displayEventDeleteSchema)
      const events = requireEventAuthoring(dependencies)
      if (input.scope === 'occurrence') events.removeOccurrence(input.id, input.occurrenceStart)
      else events.remove(input.id)
      publishInvalidation(dependencies, ['events'])
      return undefined
    }
    case 'chores:list': return read.choreDefinitions()
    case 'chores:getDay': {
      const input = await readJsonBody(request, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict())
      return read.choresForDay(input.date)
    }
    case 'stars:balances': return read.balances()
    case 'rewards:list': return read.rewards()
    case 'lists:getAll': return dependencies.lists.queries.getAll()
    case 'meals:getRange': {
      const input = await readJsonBody(request, z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict())
      return dependencies.meals.queries.getRange(input.start, input.end)
    }
    case 'weather:get': return fetchWeather(dependencies.settings.get().weather)
    case 'weather:searchCity': {
      const { query } = await readJsonBody(request, z.object({ query: z.string().min(1).max(120) }).strict())
      return searchCity(query)
    }
    case 'rss:getFeed': {
      if (dependencies.rss === undefined) throw new ApiRequestError(503, 'service_unavailable', 'News is unavailable')
      const { feedId } = await readJsonBody(request, z.object({ feedId: z.string().min(1).max(60) }).strict())
      return dependencies.rss.getFeed(feedId)
    }
    case 'screensaver:listPhotos': {
      if (dependencies.media === undefined) return []
      return dependencies.media.listPhotos().map((photo: { id: string }) => `/api/v1/display/media/${encodeURIComponent(photo.id)}`)
    }
    case 'auth:getStatus': return { pinSet: true, unlocked: (displayEditUntil.get(device.id) ?? 0) >= Date.now() }
    case 'auth:verifyPin': {
      const { pin } = await readJsonBody(request, pinRequestSchema)
      try { const session = dependencies.auth.login(pin); dependencies.auth.logout(session.sessionToken); displayEditUntil.set(device.id, Date.now() + 10 * 60_000); return { valid: true } }
      catch (error) { if (error instanceof AuthError && error.status === 401) return { valid: false }; throw error }
    }
    case 'auth:lock': displayEditUntil.delete(device.id); return undefined
    case 'sync:getStatus': {
      // Previously a hardcoded 'idle', which reported fiction to the kiosk
      // while the connectivity pill showed the real state.
      const status = dependencies.syncStatus?.get()
      if (status === undefined) return { state: 'idle', lastError: null, calendars: [] }
      return {
        state: status.state,
        lastError: (status.calendars ?? []).find((calendar) => calendar.error !== null)?.error ?? null,
        calendars: (status.calendars ?? []).map((calendar) => ({ id: calendar.id, name: calendar.name, error: calendar.error }))
      }
    }
    case 'chores:complete': return displayRpcChoreCommand(request, device.id, dependencies, 'complete')
    case 'chores:uncomplete': return displayRpcChoreCommand(request, device.id, dependencies, 'undo')
    default: throw new AuthError(403, 'forbidden', 'This display capability is read-only')
  }
}

/**
 * Displays with a live parent unlock, and when it expires.
 *
 * In memory on purpose: a restart must relock every screen in the house, and a
 * window that outlived the process would be a wall-mounted board left writable by
 * a parent who walked away an hour ago.
 */
const displayEditUntil = new Map<string, number>()

/** The gate `N15` puts in front of event writes from a wall display. A locked
 * screen is refused the same way it was before the channel existed. */
function requireDisplayEditWindow(device: { id: string }): void {
  if ((displayEditUntil.get(device.id) ?? 0) < Date.now()) {
    throw new AuthError(403, 'forbidden', 'Enter the parent PIN before changing the calendar on this display')
  }
}

/** A display names the occurrence it means in the body; there is no query string
 * on an RPC channel. Otherwise identical to the parent route's rules. */
const displayEventUpdateSchema = z.union([
  z.object({ id: z.string().min(1), scope: z.literal('series').optional(), patch: updateEventRequestSchema }).strict()
    .transform((value) => ({ ...value, scope: 'series' as const, occurrenceStart: '' })),
  z.object({
    id: z.string().min(1), scope: z.literal('occurrence'),
    occurrenceStart: z.string().datetime({ offset: true }), patch: updateEventRequestSchema
  }).strict()
])

const displayEventDeleteSchema = z.union([
  z.object({ id: z.string().min(1), scope: z.literal('series').optional() }).strict()
    .transform((value) => ({ ...value, scope: 'series' as const, occurrenceStart: '' })),
  z.object({ id: z.string().min(1), scope: z.literal('occurrence'), occurrenceStart: z.string().datetime({ offset: true }) }).strict()
])

async function displayRpcChoreCommand(
  request: IncomingMessage,
  deviceId: string,
  dependencies: Required<Pick<ApiRouterDependencies, 'chores' | 'settings'>> & ApiRouterDependencies,
  operation: 'complete' | 'undo'
): Promise<{ balance: number }> {
  const input = await readJsonBody(request, z.object({ choreId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict())
  const result = dependencies.chores[operation]({
    choreId: input.choreId, dueDate: input.date, actor: 'display', authorizedDate: currentHouseholdDate(dependencies.settings, dependencies.now), initiatingDeviceId: deviceId
  })
  return { balance: result.balance }
}

type WeatherSnapshot = { temperature: number; code: number; isDay: boolean; description: string; windSpeed: number; unit: 'f' | 'c'; label: string; daily: { date: string; code: number; high: number; low: number; precipProb: number | null }[]; fetchedAt: string }
const weatherCache = new Map<string, { expiresAt: number; value: WeatherSnapshot }>()
/** Open-Meteo geocoding: no API key, and the server fetches so displays do not. */
async function searchCity(query: string): Promise<{ label: string; lat: number; lon: number }[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new ApiRequestError(503, 'service_unavailable', 'City search is unavailable right now.')
  }
  if (!response.ok) throw new ApiRequestError(503, 'service_unavailable', 'City search is unavailable right now.')
  const body = await response.json() as {
    results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[]
  }
  return (body.results ?? []).map((result) => ({
    label: [result.name, result.admin1 ?? result.country].filter(Boolean).join(', '),
    lat: result.latitude,
    lon: result.longitude
  }))
}

async function fetchWeather(location: { lat: number; lon: number; label: string } | null): Promise<WeatherSnapshot | null> {
  if (location === null) return null
  const key = `${location.lat},${location.lon}`; const cached = weatherCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, label: location.label }
  const params = new URLSearchParams({ latitude: String(location.lat), longitude: String(location.lon), current: 'temperature_2m,weather_code,is_day,wind_speed_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', timezone: 'auto', forecast_days: '7' })
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
    if (!response.ok) return cached?.value ?? null
    const data = await response.json() as { current?: { temperature_2m?: number; weather_code?: number; is_day?: number; wind_speed_10m?: number }; daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: Array<number | null> } }
    if (data.current?.temperature_2m === undefined || data.current.weather_code === undefined || data.current.is_day === undefined || !data.daily?.time) return cached?.value ?? null
    const windSpeed = Math.round(data.current.wind_speed_10m ?? 0)
    const value: WeatherSnapshot = { temperature: Math.round(data.current.temperature_2m), code: data.current.weather_code, isDay: data.current.is_day === 1, description: weatherDescription(data.current.weather_code, windSpeed), windSpeed, unit: 'c', label: location.label, fetchedAt: new Date().toISOString(), daily: data.daily.time.map((date, index) => ({ date, code: data.daily!.weather_code?.[index] ?? 0, high: Math.round(data.daily!.temperature_2m_max?.[index] ?? 0), low: Math.round(data.daily!.temperature_2m_min?.[index] ?? 0), precipProb: data.daily!.precipitation_probability_max?.[index] ?? null })) }
    weatherCache.set(key, { value, expiresAt: Date.now() + 10 * 60_000 })
    return value
  } catch { return cached?.value ?? null }
}

function weatherDescription(code: number, windSpeed: number): string {
  const condition = code === 0 ? 'Clear' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Overcast' : code === 45 || code === 48 ? 'Foggy' : code >= 95 ? 'Thunderstorms' : code >= 71 && code <= 86 ? 'Snowy' : code >= 51 && code <= 82 ? 'Rainy' : 'Cloudy'
  return windSpeed >= 30 ? `${condition} and windy` : condition
}

async function searchWeatherLocations(query: string): Promise<Array<{ label: string; lat: number; lon: number }>> {
  const normalized = query.trim(); if (normalized.length < 2) return []
  const params = new URLSearchParams({ name: normalized, count: '8', language: 'en', format: 'json' })
  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`); if (!response.ok) return []
    const data = await response.json() as { results?: Array<{ name?: string; latitude?: number; longitude?: number; admin1?: string; country?: string }> }
    return (data.results ?? []).filter((item) => item.name && item.latitude !== undefined && item.longitude !== undefined).map((item) => ({ label: [item.name, item.admin1, item.country].filter(Boolean).join(', '), lat: item.latitude!, lon: item.longitude! }))
  } catch { return [] }
}

function currentHouseholdDate(settings: HouseholdSettingsService, now: (() => Date) | undefined): string {
  const date = DateTime.fromJSDate((now ?? (() => new Date()))()).setZone(settings.get().timezone).toISODate()
  if (date === null) throw new ApiRequestError(500, 'internal_error', 'Unable to determine household date')
  return date
}

/**
 * The peer address as the OS reports it. Deliberately not `x-forwarded-for`:
 * that header is caller-supplied, so trusting it would let anyone who can set a
 * header walk straight past a per-address rate limit.
 */
function clientAddress(request: IncomingMessage): string {
  return request.socket?.remoteAddress ?? 'unknown'
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function sendMedia(response: ServerResponse, media: { path: string; mediaType: string; byteSize: number } | undefined): true {
  if (media === undefined) throw new ApiRequestError(404, 'not_found', 'Celebration media not found')
  response.writeHead(200, {
    'content-type': media.mediaType,
    'content-length': String(media.byteSize),
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff'
  })
  createReadStream(media.path).on('error', () => response.destroy()).pipe(response)
  return true
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = readHeader(request, 'cookie')
  if (header === undefined) return undefined
  return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

/**
 * The one route that is deliberately reachable cross-origin and needs no header
 * a hostile page cannot set. That combination would otherwise make it a
 * CORS-*simple* request — sendable without a preflight — and every wrong PIN it
 * carries feeds the household-wide backoff, so any page a parent happened to
 * visit could lock them out of their own PIN screen for fifteen minutes.
 *
 * Demanding JSON closes that: `application/json` is not a simple content type,
 * so a browser must preflight, and the preflight fails for want of any CORS
 * response header. A real client sends this already; only the forged request
 * notices.
 */
function assertJsonContentType(request: IncomingMessage): void {
  const contentType = readHeader(request, 'content-type')?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new ApiRequestError(415, 'bad_request', 'This endpoint requires a Content-Type of application/json')
  }
}

function assertSameOrigin(request: IncomingMessage): void {
  const origin = readHeader(request, 'origin')
  const host = readHeader(request, 'host')
  if (origin === undefined || host === undefined) throw new AuthError(403, 'forbidden', 'A same-origin request is required')
  const protocol = readHeader(request, 'x-forwarded-proto') === 'https' ? 'https' : 'http'
  if (origin !== `${protocol}://${host}`) throw new AuthError(403, 'forbidden', 'Request origin is not allowed')
}

/**
 * Decides a parent request that arrives with an `Authorization` header, and
 * returns false only when there is no such header, leaving the browser path to
 * run unchanged. When the header is present this is the *exclusive* decision:
 * a failed bearer never falls back to the cookie, so a stale session cookie
 * riding along cannot rescue a revoked or forged token.
 *
 * The bearer branch deliberately runs neither the CSRF check nor
 * `assertSameOrigin`, and that is not a relaxation. Both exist to defend an
 * *ambient* credential: the browser attaches the session cookie to whatever
 * request a hostile page provokes, so the server demands proof the caller
 * meant it. A bearer token is not ambient — no browser attaches it on a
 * foreign page's behalf, because only the paired app holds it. There is
 * nothing here for CSRF or an origin check to defend, and requiring them would
 * simply lock out the cross-origin app this path exists to serve.
 *
 * A missing registry refuses rather than falling through to the cookie. The
 * server cannot validate the token it was handed, and answering a credential it
 * cannot check by quietly evaluating a different one would make the exclusivity
 * above true only in a fully wired deployment. The refusal is worded exactly
 * like a rejected token so a caller cannot tell the two apart.
 */
function decidedByParentBearer(dependencies: ApiRouterDependencies, request: IncomingMessage): boolean {
  if (readHeader(request, 'authorization') === undefined) return false
  const parentDevices = dependencies.parentDevices
  if (parentDevices === undefined || parentDevices.authenticate(readBearerToken(request)) === undefined) {
    throw new AuthError(401, 'unauthorized', 'A paired parent credential is required')
  }
  return true
}

function requireParentRead(dependencies: ApiRouterDependencies, request: IncomingMessage): void {
  if (decidedByParentBearer(dependencies, request)) return
  const auth = dependencies.auth
  if (auth === undefined || auth.getParentSession(readCookie(request, PARENT_SESSION_COOKIE)) === undefined) {
    throw new AuthError(401, 'unauthorized', 'Parent session is required')
  }
}

function requireParentMutation(dependencies: ApiRouterDependencies, request: IncomingMessage): void {
  if (decidedByParentBearer(dependencies, request)) return
  assertSameOrigin(request)
  const auth = dependencies.auth
  if (auth === undefined) throw new ApiRequestError(503, 'service_unavailable', 'Authentication service is unavailable')
  auth.requireParentMutation(readCookie(request, PARENT_SESSION_COOKIE), readHeader(request, CSRF_HEADER))
}

function publishInvalidation(dependencies: ApiRouterDependencies, resources: string[]): void {
  dependencies.eventStream?.publish({ type: 'query.invalidated', data: { resources } })
}

function readBearerToken(request: IncomingMessage): string | undefined {
  const authorization = readHeader(request, 'authorization')
  return authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1]
}

function setParentSessionCookie(response: ServerResponse, request: IncomingMessage, token: string, expiresAt: string): void {
  const secure = readHeader(request, 'x-forwarded-proto') === 'https' ? '; Secure' : ''
  // Lax keeps the cookie off cross-site subrequests and POSTs while still
  // surviving an ordinary top-level navigation back into the admin app.
  response.setHeader('set-cookie', `${PARENT_SESSION_COOKIE}=${token}; Path=/api/v1; HttpOnly; SameSite=Lax${secure}; Expires=${new Date(expiresAt).toUTCString()}`)
}

function clearParentSessionCookie(response: ServerResponse, request: IncomingMessage): void {
  const secure = readHeader(request, 'x-forwarded-proto') === 'https' ? '; Secure' : ''
  response.setHeader('set-cookie', `${PARENT_SESSION_COOKIE}=; Path=/api/v1; HttpOnly; SameSite=Lax${secure}; Max-Age=0`)
}
