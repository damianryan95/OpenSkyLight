import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { DisplayDeviceService, DisplayEnrolmentService, HouseholdAuthService, ParentDeviceService, normalizeEnrolmentCode } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createChoresRewardsService, createDisplayReadService, createHouseholdSettingsService, createListsDomain, createMealsDomain, createPeopleService } from '../../src/server/domain'

const temporaryDirectories: string[] = []

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-enrolment-'))
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

const JSON_HEADERS = { 'content-type': 'application/json' }

interface Harness {
  db: ServerDatabase
  deps: ApiRouterDependencies
  displays: DisplayDeviceService
  advance(ms: number): void
}

/** A full parent and display surface, over a clock the test can move. */
function harness(): Harness {
  const db = database()
  let nowMs = Date.parse('2026-09-24T09:00:00.000Z')
  const clock = { now: () => new Date(nowMs) }
  const auth = new HouseholdAuthService(db.sqlite, clock)
  const displays = new DisplayDeviceService(db.sqlite, clock)
  const parentDevices = new ParentDeviceService(db.sqlite, clock)
  const displayEnrolment = new DisplayEnrolmentService(db.sqlite, displays, clock)
  const settings = createHouseholdSettingsService(db.sqlite)
  const chores = createChoresRewardsService(db.sqlite)
  const deps: ApiRouterDependencies = {
    auth, displays, displayEnrolment, parentDevices, settings, chores,
    people: createPeopleService(db.sqlite), lists: createListsDomain(db.sqlite), meals: createMealsDomain(db.sqlite),
    displayRead: createDisplayReadService(db.sqlite, chores)
  }
  return { db, deps, displays, advance: (ms: number) => { nowMs += ms } }
}

/** A paired phone's bearer credential: the N17 path an app actually uses. */
async function parentBearer(deps: ApiRouterDependencies, pin = '1234'): Promise<Record<string, string>> {
  deps.auth!.setup(pin)
  const paired = await call('POST', '/api/v1/parent-devices', JSON_HEADERS, { pin, name: 'Mum phone' }, deps)
  expect(paired.status).toBe(201)
  return { authorization: `Bearer ${(JSON.parse(paired.body) as { credential: string }).credential}`, ...JSON_HEADERS }
}

interface Minted { code: string, pollToken: string, expiresAt: string }

async function mint(deps: ApiRouterDependencies): Promise<Minted> {
  const response = await call('POST', '/api/v1/display/enrolment-code', JSON_HEADERS, {}, deps)
  expect(response.status).toBe(201)
  return JSON.parse(response.body) as Minted
}

const claim = async (deps: ApiRouterDependencies, pollToken: string): Promise<TestResponse> =>
  call('POST', '/api/v1/display/enrolment-code/claim', JSON_HEADERS, { pollToken }, deps)

const enrol = async (deps: ApiRouterDependencies, headers: Record<string, string>, code: string, name: string): Promise<TestResponse> =>
  call('POST', '/api/v1/displays/enrol', headers, { code, name }, deps)

describe('screen-displayed QR enrolment', () => {
  it('walks the whole ceremony: mint, adopt, claim, and a credential that works', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)

    // 1. An unregistered screen asks to be adopted. No credential of any kind.
    const minted = await mint(deps)
    expect(minted.code).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/)
    expect(minted.pollToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(Date.parse(minted.expiresAt) - Date.parse('2026-09-24T09:00:00.000Z')).toBe(5 * 60 * 1000)

    // 2. It polls while the code is on the wall.
    const pending = await claim(deps, minted.pollToken)
    expect(pending.status).toBe(200)
    expect(JSON.parse(pending.body)).toEqual({ status: 'pending' })

    // 3. A parent scans and adopts it. The phone never sees the credential.
    const adopted = await enrol(deps, parent, minted.code, 'Kitchen')
    expect(adopted.status).toBe(201)
    const display = JSON.parse(adopted.body) as Record<string, unknown>
    expect(display).toMatchObject({ name: 'Kitchen', lastSeenAt: null, revokedAt: null })
    expect(display).not.toHaveProperty('credential')
    expect(adopted.body).not.toContain(minted.pollToken)
    expect(adopted.body).not.toContain(minted.code)

    // 4. The polling screen collects its credential.
    const collected = await claim(deps, minted.pollToken)
    expect(collected.status).toBe(200)
    const result = JSON.parse(collected.body) as { status: string, credential: string, display: { id: string, name: string } }
    expect(result.status).toBe('adopted')
    expect(result.display).toMatchObject({ id: display.id, name: 'Kitchen' })
    expect(result.credential).toMatch(/^[A-Za-z0-9_-]{32,}$/)

    // 5. And it is a real display credential on a real display route.
    const asDisplay = { authorization: `Bearer ${result.credential}` }
    const session = await call('GET', '/api/v1/display/session', asDisplay, undefined, deps)
    expect(session.status).toBe(200)
    expect(JSON.parse(session.body)).toEqual({ display: expect.objectContaining({ id: display.id, name: 'Kitchen' }) })
    expect((await call('POST', '/api/rpc/people%3Alist', asDisplay, {}, deps)).status).toBe(200)

    // The screen is listed to the parent exactly as a display registered the
    // old way would be, and without its credential.
    const listed = await call('GET', '/api/v1/displays', parent, undefined, deps)
    expect(JSON.parse(listed.body).displays).toHaveLength(1)
    expect(listed.body).not.toContain(result.credential)
    db.close()
  })

  it('releases the credential exactly once, so a captured claim cannot be replayed', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)
    expect((await enrol(deps, parent, minted.code, 'Kitchen')).status).toBe(201)

    const first = JSON.parse((await claim(deps, minted.pollToken)).body) as { status: string, credential: string }
    expect(first.status).toBe('adopted')

    const second = await claim(deps, minted.pollToken)
    expect(second.status).toBe(200)
    expect(JSON.parse(second.body)).toEqual({ status: 'expired' })
    expect(second.body).not.toContain(first.credential)

    // The already-issued credential is untouched: a replay is refused a second
    // credential, it does not break the screen that holds the first.
    expect((await call('GET', '/api/v1/display/session', { authorization: `Bearer ${first.credential}` }, undefined, deps)).status).toBe(200)
    db.close()
  })

  it('never lets the photographable code stand in for the poll token', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)
    await enrol(deps, parent, minted.code, 'Kitchen')

    // Everything a stranger standing in the room can have is the code.
    for (const guess of [minted.code, normalizeEnrolmentCode(minted.code), minted.code.toLowerCase()]) {
      const attempt = await claim(deps, guess)
      expect(JSON.parse(attempt.body)).toEqual({ status: 'expired' })
      expect(attempt.body).not.toMatch(/credential/)
    }

    // And the screen that actually minted it is still able to collect.
    expect((JSON.parse((await claim(deps, minted.pollToken)).body) as { status: string }).status).toBe('adopted')
    db.close()
  })

  it('returns the poll token from the mint and from nowhere else', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)

    const responses = [
      await claim(deps, minted.pollToken),
      await enrol(deps, parent, minted.code, 'Kitchen'),
      await claim(deps, minted.pollToken),
      await call('GET', '/api/v1/displays', parent, undefined, deps),
      await call('GET', '/api/v1/auth/status', parent, undefined, deps)
    ]
    for (const response of responses) {
      expect(response.body).not.toContain(minted.pollToken)
      expect(response.body).not.toContain(minted.code)
    }

    // Nor is either secret recoverable from storage.
    const row = db.sqlite.prepare('SELECT code_hash, poll_token_hash FROM display_enrolment_codes').get() as { code_hash: Buffer, poll_token_hash: Buffer }
    expect(row.code_hash.toString('utf8')).not.toContain(minted.code)
    expect(row.poll_token_hash.toString('utf8')).not.toContain(minted.pollToken)
    expect(JSON.stringify(db.sqlite.prepare('SELECT * FROM display_enrolment_codes').all())).not.toContain(minted.pollToken)
    db.close()
  })

  it('refuses an expired code, and indistinguishably from one that never existed', async () => {
    const { db, deps, advance } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)

    advance(5 * 60 * 1000 + 1)
    const expired = await enrol(deps, parent, minted.code, 'Kitchen')
    const unknown = await enrol(deps, parent, 'ZZZZZZZZ', 'Kitchen')
    const malformed = await enrol(deps, parent, 'not-a-code', 'Kitchen')

    expect(expired.status).toBe(401)
    expect(unknown.status).toBe(expired.status)
    expect(malformed.status).toBe(expired.status)
    expect(unknown.body).toBe(expired.body)
    expect(malformed.body).toBe(expired.body)
    expect(JSON.parse(expired.body).error.message).not.toMatch(/expired|already|unknown/i)

    // Nothing was registered by any of them.
    expect(deps.displays!.list()).toEqual([])
    // And the screen polling that dead code learns only 'expired'.
    expect(JSON.parse((await claim(deps, minted.pollToken)).body)).toEqual({ status: 'expired' })
    db.close()
  })

  it('refuses a second redemption of the same code, identically', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)

    expect((await enrol(deps, parent, minted.code, 'Kitchen')).status).toBe(201)
    const again = await enrol(deps, parent, minted.code, 'Hallway')
    const unknown = await enrol(deps, parent, 'ZZZZZZZZ', 'Hallway')
    expect(again.status).toBe(401)
    expect(again.body).toBe(unknown.body)
    expect(deps.displays!.list().map((display) => display.name)).toEqual(['Kitchen'])
    db.close()
  })

  it('accepts a code a parent retyped with the ambiguous letters and separators', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)
    // What a human types: lower case, a hyphen for readability, and O/I/L where
    // the screen showed 0/1/1.
    const retyped = `${minted.code.slice(0, 4)}-${minted.code.slice(4)}`.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')
    const adopted = await enrol(deps, parent, retyped, 'Kitchen')
    expect(adopted.status).toBe(201)
    expect(JSON.parse(adopted.body)).toMatchObject({ name: 'Kitchen' })
    db.close()
  })

  it('does not burn the code when the chosen name is already taken', async () => {
    const { db, deps, displays } = harness()
    const parent = await parentBearer(deps)
    displays.register({ name: 'Kitchen' })
    const minted = await mint(deps)

    const clash = await enrol(deps, parent, minted.code, 'Kitchen')
    expect(clash.status).toBe(409)
    // The registration and the redemption roll back together, so the parent can
    // simply try another name rather than walk back to the screen for a new code.
    const retried = await enrol(deps, parent, minted.code, 'Kitchen wall')
    expect(retried.status).toBe(201)
    // Sorted: both rows register within the same millisecond, so `list()` falls
    // through its `registered_at` ordering to a random id and the order here is
    // genuinely undefined. Asserting one was a coin flip that passed locally.
    expect(deps.displays!.list().map((display) => display.name).sort()).toEqual(['Kitchen', 'Kitchen wall'])
    expect((JSON.parse((await claim(deps, minted.pollToken)).body) as { status: string, display: { name: string } }).display.name).toBe('Kitchen wall')
    db.close()
  })

  it('requires parent authentication to redeem, and a display credential is not it', async () => {
    const { db, deps, displays } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)
    const displayCredential = displays.register({ name: 'Existing screen' }).credential

    // A browser caller with no session at all: refused as every other parent
    // mutation refuses one.
    const anonymous = await enrol(deps, { origin: 'http://server.test', host: 'server.test', ...JSON_HEADERS }, minted.code, 'Kitchen')
    expect(anonymous.status).toBe(401)
    // No credential and no origin either — refused before the session check.
    expect((await enrol(deps, JSON_HEADERS, minted.code, 'Kitchen')).status).toBe(403)
    // A registered display may ask for a code; it may not adopt a screen.
    const asDisplay = await enrol(deps, { authorization: `Bearer ${displayCredential}`, ...JSON_HEADERS }, minted.code, 'Kitchen')
    expect(asDisplay.status).toBe(401)
    expect(JSON.parse(asDisplay.body).error.message).toMatch(/paired parent credential/i)
    // A cookie without a CSRF token is refused too.
    const halfBrowser = await enrol(deps, { origin: 'http://server.test', host: 'server.test', cookie: 'osl_parent_session=nonsense', ...JSON_HEADERS }, minted.code, 'Kitchen')
    expect(halfBrowser.status).toBe(403)

    // None of that consumed the code: the real parent can still redeem it.
    expect(deps.displays!.list().map((display) => display.name)).toEqual(['Existing screen'])
    expect((await enrol(deps, parent, minted.code, 'Kitchen')).status).toBe(201)
    db.close()
  })

  it('lets the browser parent path redeem too, with cookie, CSRF token and origin', async () => {
    const { db, deps } = harness()
    const session = deps.auth!.setup('1234')
    const minted = await mint(deps)
    const browser = { origin: 'http://server.test', host: 'server.test', cookie: `osl_parent_session=${session.sessionToken}`, 'x-osl-csrf-token': session.csrfToken, ...JSON_HEADERS }
    expect((await enrol(deps, browser, minted.code, 'Kitchen')).status).toBe(201)
    db.close()
  })

  it('leaves the A03 parent registration route working unchanged', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)
    const registered = await call('POST', '/api/v1/displays', parent, { name: 'Landing' }, deps)
    expect(registered.status).toBe(201)
    const body = JSON.parse(registered.body) as { id: string, credential: string }
    expect(body.credential).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect((await call('GET', '/api/v1/display/session', { authorization: `Bearer ${body.credential}` }, undefined, deps)).status).toBe(200)
    // And `enrol` was not swallowed by the `/displays/:id` route.
    expect((await call('PATCH', `/api/v1/displays/${body.id}`, parent, { name: 'Landing screen' }, deps)).status).toBe(200)
    db.close()
  })

  it('rejects a CORS-simple mint and claim, and anything but POST', async () => {
    const { db, deps } = harness()
    for (const path of ['/api/v1/display/enrolment-code', '/api/v1/display/enrolment-code/claim', '/api/v1/displays/enrol']) {
      expect((await call('POST', path, { 'content-type': 'text/plain', origin: 'http://evil.test' }, {}, deps)).status).toBe(415)
      expect((await call('GET', path, JSON_HEADERS, undefined, deps)).status).toBe(405)
    }
    expect(db.sqlite.prepare('SELECT COUNT(*) AS total FROM display_enrolment_codes').get()).toMatchObject({ total: 0 })
    db.close()
  })

  it('rate-limits minting per client address rather than letting the table be filled', async () => {
    const { db, deps } = harness()
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await call('POST', '/api/v1/display/enrolment-code', JSON_HEADERS, {}, deps)).status).toBe(201)
    }
    const throttled = await call('POST', '/api/v1/display/enrolment-code', JSON_HEADERS, {}, deps)
    expect(throttled.status).toBe(429)
    expect(throttled.headers.get('retry-after')).toEqual(expect.any(String))
    expect(db.sqlite.prepare('SELECT COUNT(*) AS total FROM display_enrolment_codes').get()).toMatchObject({ total: 30 })
    db.close()
  })

  it('rate-limits failed redemptions so codes cannot be guessed', async () => {
    const { db, deps } = harness()
    const parent = await parentBearer(deps)
    const minted = await mint(deps)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await enrol(deps, parent, 'ZZZZZZZZ', `Guess ${attempt}`)).status).toBe(401)
    }
    const throttled = await enrol(deps, parent, minted.code, 'Kitchen')
    expect(throttled.status).toBe(429)
    expect(deps.displays!.list()).toEqual([])
    db.close()
  })
})
