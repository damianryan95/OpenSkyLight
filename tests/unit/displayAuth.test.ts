import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DisplayDeviceService, HouseholdAuthService, ParentDeviceService } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createChoresRewardsService, createDisplayReadService, createHouseholdSettingsService, createListsDomain, createMealsDomain, createPeopleService } from '../../src/server/domain'
import { createEventAuthoringService } from '../../src/server/domain/events'
import { createEventWriteService } from '../../src/server/domain/eventWrites'

const temporaryDirectories: string[] = []

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-displays-'))
  temporaryDirectories.push(directory)
  return openServerDatabase(join(directory, 'openskylight.db'))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class TestResponse {
  status = 200
  readonly headers = new Map<string, string>()
  body = ''
  setHeader(name: string, value: string): this { this.headers.set(name.toLowerCase(), value); return this }
  writeHead(status: number, headers?: Record<string, string>): this { this.status = status; for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value); return this }
  end(body?: string): this { this.body = body ?? ''; return this }
}

function request(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url: path, headers }) as IncomingMessage
}

async function call(method: string, path: string, headers: Record<string, string>, body: unknown, dependencies: ApiRouterDependencies): Promise<TestResponse> {
  const response = new TestResponse()
  await handleApiRequest(request(method, path, headers, body), response as unknown as ServerResponse, dependencies)
  return response
}

describe('display registration and capabilities', () => {
  it('requires a parent session for registration and returns the credential exactly once', async () => {
    const db = database()
    const auth = new HouseholdAuthService(db.sqlite)
    const displays = new DisplayDeviceService(db.sqlite)
    const deps = { auth, displays, parentDevices: new ParentDeviceService(db.sqlite) }
    const baseHeaders = { origin: 'http://server.test', host: 'server.test', 'content-type': 'application/json' }

    expect((await call('POST', '/api/v1/displays', baseHeaders, { name: 'Kitchen' }, deps)).status).toBe(401)
    const session = auth.setup('1234')
    const headers = { ...baseHeaders, cookie: `osl_parent_session=${session.sessionToken}`, 'x-osl-csrf-token': session.csrfToken }
    const created = await call('POST', '/api/v1/displays', headers, { name: 'Kitchen', themePreference: { mode: 'dark' } }, deps)
    expect(created.status).toBe(201)
    const registration = JSON.parse(created.body) as { id: string, credential: string, themePreference: unknown }
    expect(registration.credential).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(registration.themePreference).toEqual({ mode: 'dark' })
    expect(JSON.stringify(displays.list())).not.toContain(registration.credential)
    expect((db.sqlite.prepare('SELECT credential_hash FROM devices WHERE id = ?').get(registration.id) as { credential_hash: Buffer }).credential_hash).not.toEqual(Buffer.from(registration.credential))
    db.close()
  })

  it('enforces the parent/display capability matrix and revocation immediately', async () => {
    const db = database()
    const auth = new HouseholdAuthService(db.sqlite)
    const displays = new DisplayDeviceService(db.sqlite)
    const deps = { auth, displays, parentDevices: new ParentDeviceService(db.sqlite) }
    const session = auth.setup('1234')
    const parentHeaders = { origin: 'http://server.test', host: 'server.test', 'content-type': 'application/json', cookie: `osl_parent_session=${session.sessionToken}`, 'x-osl-csrf-token': session.csrfToken }
    const registration = JSON.parse((await call('POST', '/api/v1/displays', parentHeaders, { name: 'Kitchen' }, deps)).body) as { id: string, credential: string }
    const displayHeaders = { authorization: `Bearer ${registration.credential}` }

    const renamed = await call('PATCH', `/api/v1/displays/${registration.id}`, parentHeaders, { name: 'Kitchen Wall', sleepSettings: { bedtime: '21:00' } }, deps)
    expect(renamed.status).toBe(200)
    expect(JSON.parse(renamed.body)).toMatchObject({ name: 'Kitchen Wall', sleepSettings: { bedtime: '21:00' } })
    const listed = await call('GET', '/api/v1/displays', { cookie: parentHeaders.cookie }, undefined, deps)
    expect(listed.status).toBe(200)
    expect(JSON.parse(listed.body)).toEqual({ displays: [expect.objectContaining({ id: registration.id, name: 'Kitchen Wall' })] })

    // A display credential permits the display-scoped read, but cannot access a parent mutation.
    expect((await call('GET', '/api/v1/display/session', displayHeaders, undefined, deps)).status).toBe(200)
    expect((await call('GET', '/api/v1/display/session', { authorization: 'Bearer not-a-device-credential' }, undefined, deps)).status).toBe(401)
    // 401, not 403: a display credential is a bearer token, so it is answered
    // by the parent bearer registry and rejected there — it never reaches the
    // origin check that used to produce the 403.
    expect((await call('POST', '/api/v1/displays', displayHeaders, { name: 'Forbidden' }, deps)).status).toBe(401)
    expect((await call('GET', '/api/v1/displays', displayHeaders, undefined, deps)).status).toBe(401)

    expect((await call('POST', `/api/v1/displays/${registration.id}/revoke`, parentHeaders, undefined, deps)).status).toBe(204)
    expect((await call('GET', '/api/v1/display/session', displayHeaders, undefined, deps)).status).toBe(401)
    const device = displays.list()[0]
    expect(device.revokedAt).toEqual(expect.any(String))
    db.close()
  })

  it('only permits layout mutations after the parent PIN is entered on that display', async () => {
    const db = database()
    const auth = new HouseholdAuthService(db.sqlite)
    const displays = new DisplayDeviceService(db.sqlite)
    const settings = createHouseholdSettingsService(db.sqlite)
    const chores = createChoresRewardsService(db.sqlite)
    const dependencies = {
      auth, displays, parentDevices: new ParentDeviceService(db.sqlite), settings, chores,
      people: createPeopleService(db.sqlite), lists: createListsDomain(db.sqlite), meals: createMealsDomain(db.sqlite),
      displayRead: createDisplayReadService(db.sqlite, chores)
    }
    const credential = displays.register({ name: 'Kitchen' }).credential
    const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }
    // K03's remaining guarantees, narrowed twice now (by N06 and N15) and still
    // absolute for everything listed here. These stay refused whether or not the
    // parent PIN unlock is live — only calendar events and today's chores were
    // ever carved out, and the carve-out is asserted separately below.
    const forbiddenMutations = [
      'app:installUpdate',
      'people:create', 'people:update', 'people:delete',
      'calendars:create', 'calendars:update', 'calendars:delete',
      'google:setCredentials', 'google:connect', 'google:disconnect', 'google:setCalendarSelected', 'ics:add', 'sync:now',
      'chores:create', 'chores:update', 'chores:delete',
      'rewards:create', 'rewards:update', 'rewards:delete', 'rewards:redeem', 'rewards:grant',
      'lists:create', 'lists:update', 'lists:delete', 'listItems:add', 'listItems:toggle', 'listItems:delete', 'listItems:clearChecked',
      'meals:set', 'screensaver:pickFolder', 'kiosk:previewScreensaver',
      'companion:issueToken', 'companion:unpairAll', 'auth:setPin'
    ]
    for (const channel of forbiddenMutations) {
      const result = await call('POST', `/api/rpc/${encodeURIComponent(channel)}`, headers, {}, dependencies)
      expect(result.status, channel).toBe(403)
    }

    expect((await call('POST', '/api/rpc/settings%3Aset', headers, { patch: { homeLayout: [] } }, dependencies)).status).toBe(403)
    auth.setup('1234')
    const rejectedPin = await call('POST', '/api/rpc/auth%3AverifyPin', headers, { pin: '0000' }, dependencies)
    expect(rejectedPin.status).toBe(200)
    expect(JSON.parse(rejectedPin.body)).toEqual({ ok: true, data: { valid: false } })

    const acceptedPin = await call('POST', '/api/rpc/auth%3AverifyPin', headers, { pin: '1234' }, dependencies)
    expect(acceptedPin.status).toBe(200)
    expect(JSON.parse(acceptedPin.body)).toEqual({ ok: true, data: { valid: true } })
    expect((await call('POST', '/api/rpc/settings%3Aset', headers, { patch: { homeLayout: [] } }, dependencies)).status).toBe(200)
    expect(displays.list()[0].homeLayout).toEqual([])

    expect((await call('POST', '/api/rpc/auth%3Alock', headers, {}, dependencies)).status).toBe(200)
    expect((await call('POST', '/api/rpc/settings%3Aset', headers, { patch: { homeLayout: [] } }, dependencies)).status).toBe(403)
    db.close()
  })

  /**
   * The narrowing `N15` makes, stated as its own test so the boundary is visible
   * rather than implied: calendar events become writable from a wall display, and
   * only inside the PIN window, and nothing else moves.
   */
  it('lets a PIN-unlocked display write calendar events, and refuses them again once it locks', async () => {
    const db = database()
    const auth = new HouseholdAuthService(db.sqlite)
    const displays = new DisplayDeviceService(db.sqlite)
    const settings = createHouseholdSettingsService(db.sqlite)
    const chores = createChoresRewardsService(db.sqlite)
    const writes = createEventWriteService(db.sqlite)
    const dependencies = {
      auth, displays, parentDevices: new ParentDeviceService(db.sqlite), settings, chores,
      people: createPeopleService(db.sqlite), lists: createListsDomain(db.sqlite), meals: createMealsDomain(db.sqlite),
      displayRead: createDisplayReadService(db.sqlite, chores),
      eventAuthoring: createEventAuthoringService(db.sqlite, writes)
    }
    const credential = displays.register({ name: 'Kitchen' }).credential
    const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }
    auth.setup('1234')
    const draft = {
      title: 'Dentist', description: null, location: null,
      startAt: '2026-06-15T09:00:00.000Z', endAt: '2026-06-15T10:00:00.000Z',
      timezone: 'Europe/London', allDay: false, recurrence: null, personId: null
    }

    // Locked: refused exactly as it was before the channel existed.
    for (const channel of ['events:create', 'events:update', 'events:delete']) {
      const locked = await call('POST', `/api/rpc/${encodeURIComponent(channel)}`, headers, { ...draft, id: 'whatever' }, dependencies)
      expect(locked.status, channel).toBe(403)
    }

    expect((await call('POST', '/api/rpc/auth%3AverifyPin', headers, { pin: '1234' }, dependencies)).status).toBe(200)

    const created = await call('POST', '/api/rpc/events%3Acreate', headers, draft, dependencies)
    expect(created.status).toBe(200)
    const eventId = (JSON.parse(created.body) as { data: { id: string } }).data.id
    expect((await call('POST', '/api/rpc/events%3Aupdate', headers, { id: eventId, patch: { title: 'Dentist (moved)' } }, dependencies)).status).toBe(200)
    expect((await call('POST', '/api/rpc/events%3Adelete', headers, { id: eventId }, dependencies)).status).toBe(200)

    // A reading channel the editor needs, and it is a read, so it never needed a gate.
    expect((await call('POST', '/api/rpc/events%3Aget', headers, { id: eventId }, dependencies)).status).toBe(200)

    // Locking again leaves no writable surface behind.
    expect((await call('POST', '/api/rpc/auth%3Alock', headers, {}, dependencies)).status).toBe(200)
    for (const channel of ['events:create', 'events:update', 'events:delete']) {
      const relocked = await call('POST', `/api/rpc/${encodeURIComponent(channel)}`, headers, { ...draft, id: eventId }, dependencies)
      expect(relocked.status, channel).toBe(403)
    }
    db.close()
  })

  it('expires the editing window without being locked, and refuses writes again', async () => {
    const db = database()
    const auth = new HouseholdAuthService(db.sqlite)
    const displays = new DisplayDeviceService(db.sqlite)
    const settings = createHouseholdSettingsService(db.sqlite)
    const chores = createChoresRewardsService(db.sqlite)
    const dependencies = {
      auth, displays, parentDevices: new ParentDeviceService(db.sqlite), settings, chores,
      people: createPeopleService(db.sqlite), lists: createListsDomain(db.sqlite), meals: createMealsDomain(db.sqlite),
      displayRead: createDisplayReadService(db.sqlite, chores),
      eventAuthoring: createEventAuthoringService(db.sqlite, createEventWriteService(db.sqlite))
    }
    const credential = displays.register({ name: 'Kitchen' }).credential
    const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }
    auth.setup('1234')
    await call('POST', '/api/rpc/auth%3AverifyPin', headers, { pin: '1234' }, dependencies)
    expect(JSON.parse((await call('POST', '/api/rpc/auth%3AgetStatus', headers, {}, dependencies)).body))
      .toEqual({ ok: true, data: { pinSet: true, unlocked: true } })

    // The window is a wall-clock deadline, so moving past it is what expiry is.
    const eleven = new Date(Date.now() + 11 * 60_000)
    vi.useFakeTimers()
    vi.setSystemTime(eleven)
    try {
      expect(JSON.parse((await call('POST', '/api/rpc/auth%3AgetStatus', headers, {}, dependencies)).body))
        .toEqual({ ok: true, data: { pinSet: true, unlocked: false } })
      const draft = {
        title: 'Dentist', description: null, location: null,
        startAt: '2026-06-15T09:00:00.000Z', endAt: '2026-06-15T10:00:00.000Z',
        timezone: 'Europe/London', allDay: false, recurrence: null, personId: null
      }
      expect((await call('POST', '/api/rpc/events%3Acreate', headers, draft, dependencies)).status).toBe(403)
      expect((await call('POST', '/api/rpc/settings%3Aset', headers, { patch: { homeLayout: [] } }, dependencies)).status).toBe(403)
    } finally {
      vi.useRealTimers()
    }
    db.close()
  })
})
