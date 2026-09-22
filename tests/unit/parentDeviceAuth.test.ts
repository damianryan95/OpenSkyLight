import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { DisplayDeviceService, HouseholdAuthService, ParentDeviceService } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createChoresRewardsService, createDisplayReadService, createHouseholdSettingsService, createListsDomain, createMealsDomain, createPeopleService } from '../../src/server/domain'

const temporaryDirectories: string[] = []

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-parent-devices-'))
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

/** A full parent surface: reads, mutations, displays, people. */
function harness(): { db: ServerDatabase, deps: ApiRouterDependencies, auth: HouseholdAuthService, displays: DisplayDeviceService, parentDevices: ParentDeviceService } {
  const db = database()
  const auth = new HouseholdAuthService(db.sqlite)
  const displays = new DisplayDeviceService(db.sqlite)
  const parentDevices = new ParentDeviceService(db.sqlite)
  const settings = createHouseholdSettingsService(db.sqlite)
  const chores = createChoresRewardsService(db.sqlite)
  const deps: ApiRouterDependencies = {
    auth, displays, parentDevices, settings, chores,
    people: createPeopleService(db.sqlite), lists: createListsDomain(db.sqlite), meals: createMealsDomain(db.sqlite),
    displayRead: createDisplayReadService(db.sqlite, chores)
  }
  return { db, deps, auth, displays, parentDevices }
}

const JSON_HEADERS = { 'content-type': 'application/json' }
const BROWSER_HEADERS = { origin: 'http://server.test', host: 'server.test', ...JSON_HEADERS }

async function pair(deps: ApiRouterDependencies, pin: string, name: string): Promise<TestResponse> {
  // Deliberately no cookie, no CSRF token and no Origin: a phone app pairing
  // from capacitor://localhost has none of them.
  return call('POST', '/api/v1/parent-devices', JSON_HEADERS, { pin, name }, deps)
}

describe('parent phone pairing and bearer authentication', () => {
  it('pairs with the household PIN alone and returns the credential exactly once', async () => {
    const { db, deps, parentDevices } = harness()
    const session = deps.auth!.setup('1234')

    const paired = await pair(deps, '1234', 'Mum phone')
    expect(paired.status).toBe(201)
    const device = JSON.parse(paired.body) as { id: string, name: string, credential: string, pairedAt: string, lastSeenAt: null, revokedAt: null }
    expect(device).toMatchObject({ name: 'Mum phone', lastSeenAt: null, revokedAt: null })
    expect(device.credential).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    // Pairing issues a bearer credential, never a browser session.
    expect(paired.headers.get('set-cookie')).toBeUndefined()

    // The credential exists in that response and nowhere else.
    const listed = await call('GET', '/api/v1/parent-devices', { cookie: `osl_parent_session=${session.sessionToken}` }, undefined, deps)
    expect(listed.status).toBe(200)
    expect(JSON.parse(listed.body)).toEqual({ parentDevices: [expect.objectContaining({ id: device.id, name: 'Mum phone' })] })
    expect(listed.body).not.toContain(device.credential)
    expect(JSON.stringify(parentDevices.list())).not.toContain(device.credential)
    const stored = db.sqlite.prepare('SELECT credential_hash FROM parent_devices WHERE id = ?').get(device.id) as { credential_hash: Buffer }
    expect(stored.credential_hash).not.toEqual(Buffer.from(device.credential))
    db.close()
  })

  it('authorises a parent read and a parent mutation with no cookie, no CSRF token and no Origin', async () => {
    const { db, deps } = harness()
    deps.auth!.setup('1234')
    const { credential } = JSON.parse((await pair(deps, '1234', 'Mum phone')).body) as { credential: string }
    const bearer = { authorization: `Bearer ${credential}`, ...JSON_HEADERS }
    expect(Object.keys(bearer)).not.toContain('cookie')

    const read = await call('GET', '/api/v1/people', bearer, undefined, deps)
    expect(read.status).toBe(200)
    expect(JSON.parse(read.body)).toEqual({ people: [] })

    const mutation = await call('POST', '/api/v1/people', bearer, { name: 'Ada', color: '#0091FF', role: 'child' }, deps)
    expect(mutation.status).toBe(201)
    expect(JSON.parse(mutation.body)).toMatchObject({ name: 'Ada' })
    expect(JSON.parse((await call('GET', '/api/v1/people', bearer, undefined, deps)).body).people).toHaveLength(1)
    db.close()
  })

  it('refuses a request carrying neither credential', async () => {
    const { db, deps } = harness()
    deps.auth!.setup('1234')
    expect((await call('GET', '/api/v1/people', {}, undefined, deps)).status).toBe(401)
    expect((await call('POST', '/api/v1/people', BROWSER_HEADERS, { name: 'Ada', color: '#0091FF', role: 'child' }, deps)).status).toBe(401)
    expect((await call('GET', '/api/v1/people', { authorization: 'Bearer not-a-paired-phone-credential-at-all' }, undefined, deps)).status).toBe(401)
    db.close()
  })

  it('fails a revoked credential closed on the very next request', async () => {
    const { db, deps } = harness()
    deps.auth!.setup('1234')
    const device = JSON.parse((await pair(deps, '1234', 'Mum phone')).body) as { id: string, credential: string }
    const bearer = { authorization: `Bearer ${device.credential}`, ...JSON_HEADERS }
    expect((await call('GET', '/api/v1/people', bearer, undefined, deps)).status).toBe(200)

    // Revoked from the phone's own bearer session, as a parent killing a lost
    // handset from their remaining one would.
    expect((await call('POST', `/api/v1/parent-devices/${device.id}/revoke`, bearer, undefined, deps)).status).toBe(204)
    expect((await call('GET', '/api/v1/people', bearer, undefined, deps)).status).toBe(401)
    expect((await call('POST', '/api/v1/people', bearer, { name: 'Ada', color: '#0091FF', role: 'child' }, deps)).status).toBe(401)
    expect(deps.parentDevices!.list()[0].revokedAt).toEqual(expect.any(String))
    db.close()
  })

  it('refuses a display credential on a parent route and a parent credential on a display route', async () => {
    const { db, deps, displays } = harness()
    deps.auth!.setup('1234')
    const parentCredential = (JSON.parse((await pair(deps, '1234', 'Mum phone')).body) as { credential: string }).credential
    const displayCredential = displays.register({ name: 'Kitchen' }).credential

    const asDisplay = { authorization: `Bearer ${displayCredential}`, ...JSON_HEADERS }
    expect((await call('GET', '/api/v1/people', asDisplay, undefined, deps)).status).toBe(401)
    expect((await call('POST', '/api/v1/people', asDisplay, { name: 'Ada', color: '#0091FF', role: 'child' }, deps)).status).toBe(401)
    expect((await call('GET', '/api/v1/parent-devices', asDisplay, undefined, deps)).status).toBe(401)

    const asParent = { authorization: `Bearer ${parentCredential}`, ...JSON_HEADERS }
    expect((await call('GET', '/api/v1/display/session', asParent, undefined, deps)).status).toBe(401)
    expect((await call('POST', '/api/rpc/people%3Alist', asParent, {}, deps)).status).toBe(401)
    expect((await call('POST', '/api/rpc/chores%3Alist', asParent, {}, deps)).status).toBe(401)
    // The display credential still works where it is supposed to.
    expect((await call('GET', '/api/v1/display/session', asDisplay, undefined, deps)).status).toBe(200)
    db.close()
  })

  it('refuses pairing with a wrong PIN and trips the existing backoff', async () => {
    const { db, deps, parentDevices } = harness()
    deps.auth!.setup('1234')

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const rejected = await pair(deps, '9999', `Attacker ${attempt}`)
      expect(rejected.status).toBe(401)
      expect(rejected.body).not.toContain('9999')
    }
    expect(parentDevices.list()).toEqual([])

    // The shared auth_attempt_state counter is now in backoff, so even the
    // correct PIN is throttled rather than pairing a phone.
    const throttled = await pair(deps, '1234', 'Mum phone')
    expect(throttled.status).toBe(429)
    expect(throttled.headers.get('retry-after')).toEqual(expect.any(String))
    expect(parentDevices.list()).toEqual([])
    expect(db.sqlite.prepare('SELECT failed_attempts, backoff_until FROM auth_attempt_state WHERE id = 1').get())
      .toMatchObject({ failed_attempts: 4, backoff_until: expect.any(String) })
    db.close()
  })

  it('refuses a CORS-simple pairing attempt before it can reach the shared PIN backoff', async () => {
    const { db, deps } = harness()
    deps.auth!.setup('1234')

    // text/plain is what a hostile page would send: it keeps the request
    // CORS-simple, so no preflight stands between that page and this route.
    // Rejecting it on content type forces a preflight the server never answers.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const forged = await call('POST', '/api/v1/parent-devices', { 'content-type': 'text/plain', origin: 'http://evil.test' }, { pin: '9999', name: `x${attempt}` }, deps)
      expect(forged.status).toBe(415)
    }

    // The counter was never touched, so the parent's own PIN still works.
    expect(db.sqlite.prepare('SELECT failed_attempts FROM auth_attempt_state WHERE id = 1').get()).toMatchObject({ failed_attempts: 0 })
    expect((await pair(deps, '1234', 'Mum phone')).status).toBe(201)
    db.close()
  })

  it('leaves the browser path requiring cookie, CSRF token and origin', async () => {
    const { db, deps } = harness()
    const session = deps.auth!.setup('1234')
    const cookie = `osl_parent_session=${session.sessionToken}`
    const body = { name: 'Ada', color: '#0091FF', role: 'child' as const }

    expect((await call('POST', '/api/v1/people', { ...BROWSER_HEADERS, cookie }, body, deps)).status).toBe(403)
    expect((await call('POST', '/api/v1/people', { ...BROWSER_HEADERS, cookie, 'x-osl-csrf-token': 'wrong' }, body, deps)).status).toBe(403)
    expect((await call('POST', '/api/v1/people', { ...JSON_HEADERS, cookie, 'x-osl-csrf-token': session.csrfToken }, body, deps)).status).toBe(403)
    expect((await call('POST', '/api/v1/people', { ...BROWSER_HEADERS, origin: 'http://attacker.test', cookie, 'x-osl-csrf-token': session.csrfToken }, body, deps)).status).toBe(403)
    expect((await call('POST', '/api/v1/people', { ...BROWSER_HEADERS, cookie, 'x-osl-csrf-token': session.csrfToken }, body, deps)).status).toBe(201)
    db.close()
  })

  it('never lets a cookie rescue a rejected bearer', async () => {
    const { db, deps } = harness()
    const session = deps.auth!.setup('1234')
    const device = JSON.parse((await pair(deps, '1234', 'Mum phone')).body) as { id: string, credential: string }
    const browser = { ...BROWSER_HEADERS, cookie: `osl_parent_session=${session.sessionToken}`, 'x-osl-csrf-token': session.csrfToken }
    expect((await call('GET', '/api/v1/people', browser, undefined, deps)).status).toBe(200)

    deps.parentDevices!.revoke(device.id)
    const withBoth = { ...browser, authorization: `Bearer ${device.credential}` }
    expect((await call('GET', '/api/v1/people', withBoth, undefined, deps)).status).toBe(401)
    expect((await call('POST', '/api/v1/people', withBoth, { name: 'Ada', color: '#0091FF', role: 'child' }, deps)).status).toBe(401)
    db.close()
  })
})
