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

/**
 * ADR 0006 case 1: a phone claims a household nobody has set up. This is the
 * step that used to need a browser at /admin/, and it mints a parent credential
 * with no PIN to check — so what is tested here is mostly what it refuses.
 */

const temporaryDirectories: string[] = []
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'osl-household-claim-'))
  temporaryDirectories.push(directory)
  return openServerDatabase(join(directory, 'openskylight.db'))
}

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

function harness() {
  const db = database()
  const auth = new HouseholdAuthService(db.sqlite)
  const displays = new DisplayDeviceService(db.sqlite)
  const parentDevices = new ParentDeviceService(db.sqlite)
  const chores = createChoresRewardsService(db.sqlite)
  const deps: ApiRouterDependencies = {
    auth, displays, parentDevices, chores, settings: createHouseholdSettingsService(db.sqlite),
    people: createPeopleService(db.sqlite), lists: createListsDomain(db.sqlite), meals: createMealsDomain(db.sqlite),
    displayRead: createDisplayReadService(db.sqlite, chores)
  }
  return { db, deps, auth, parentDevices }
}

/** Exactly what an app at capacitor://localhost sends: JSON, and nothing else. */
const JSON_HEADERS = { 'content-type': 'application/json' }

const claim = (deps: ApiRouterDependencies, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
  call('POST', '/api/v1/household/claim', headers, body, deps)

const parentDeviceCount = (db: ServerDatabase): number =>
  (db.sqlite.prepare('SELECT count(*) AS count FROM parent_devices').get() as { count: number }).count

describe('claiming a brand-new household from a phone', () => {
  it('sets the PIN and pairs the phone in one act, returning the credential exactly once', async () => {
    const { db, deps, auth } = harness()
    expect(auth.isConfigured()).toBe(false)

    const claimed = await claim(deps, { pin: '4821', name: 'Mum phone' })
    expect(claimed.status).toBe(201)
    const device = JSON.parse(claimed.body) as { name: string; credential: string }
    expect(device.name).toBe('Mum phone')
    expect(typeof device.credential).toBe('string')

    // Both halves happened.
    expect(auth.isConfigured()).toBe(true)
    expect(parentDeviceCount(db)).toBe(1)

    // The browser session `setup` minted along the way was not left alive — a
    // phone authenticates with the bearer, and a stray cookie session would be a
    // second credential nobody asked for. Checked before `login` below, which
    // legitimately mints one.
    const live = db.sqlite.prepare("SELECT count(*) AS count FROM auth_sessions WHERE revoked_at IS NULL").get() as { count: number }
    expect(live.count).toBe(0)

    // The credential is a real parent bearer: it reads a parent-only resource,
    // and the PIN it created is the household's PIN from now on.
    const read = await call('GET', '/api/v1/people', { authorization: `Bearer ${device.credential}` }, undefined, deps)
    expect(read.status).toBe(200)
    expect(() => auth.login('4821')).not.toThrow()
    db.close()
  })

  it('answers 409 for ever once the household is configured, and mints nothing', async () => {
    const { db, deps } = harness()
    expect((await claim(deps, { pin: '4821', name: 'Mum phone' })).status).toBe(201)

    // A second phone — or the same one again — cannot claim a claimed household.
    // This is the whole security property: the code on the wall is public, so
    // the thing it can do must stop being valuable the moment it is used once.
    const again = await claim(deps, { pin: '9999', name: 'Someone else' })
    expect(again.status).toBe(409)
    expect(parentDeviceCount(db)).toBe(1)
    // The original PIN stands; the attempted one was never installed.
    expect(() => deps.auth!.login('4821')).not.toThrow()
    expect(() => deps.auth!.login('9999')).toThrow()
    db.close()
  })

  it('refuses a request that is not JSON, so a hostile page cannot drive it without a preflight', async () => {
    const { db, deps, auth } = harness()
    const refused = await claim(deps, { pin: '4821', name: 'Mum phone' }, { 'content-type': 'text/plain' })
    expect(refused.status).toBe(415)
    expect(auth.isConfigured()).toBe(false)
    expect(parentDeviceCount(db)).toBe(0)
    db.close()
  })

  it('refuses a PIN that breaks the household rules, writing nothing', async () => {
    const { db, deps, auth } = harness()
    const short = await claim(deps, { pin: '12', name: 'Mum phone' })
    expect(short.status).toBe(401)
    expect(auth.isConfigured()).toBe(false)
    expect(parentDeviceCount(db)).toBe(0)
    db.close()
  })

  it('rolls the PIN back if the phone cannot be paired, so no half-claimed household exists', async () => {
    const { db, deps, auth } = harness()
    // Force the pairing half to fail: a blank device name is refused by pair().
    const failed = await claim(deps, { pin: '4821', name: '   ' })
    expect(failed.status).toBeGreaterThanOrEqual(400)
    // The transaction is the point. Without it this household would have a PIN
    // that no phone holds a credential for.
    expect(auth.isConfigured()).toBe(false)
    expect(parentDeviceCount(db)).toBe(0)
    // And it is still claimable afterwards.
    expect((await claim(deps, { pin: '4821', name: 'Mum phone' })).status).toBe(201)
    db.close()
  })

  it('leaves the browser setup route exactly as strict as it was', async () => {
    const { db, deps } = harness()
    // Adding a foreign-origin claim route must not have loosened the same-origin
    // route beside it. An app cannot use this one; a browser must still be
    // refused from anywhere but the household's own origin.
    const foreign = await call('POST', '/api/v1/auth/setup', { origin: 'http://attacker.test', host: 'server.test', ...JSON_HEADERS }, { pin: '4821' }, deps)
    expect(foreign.status).toBe(403)
    expect(deps.auth!.isConfigured()).toBe(false)
    db.close()
  })

  it('lets exactly one of two phones racing a brand-new screen win', async () => {
    const { db, deps } = harness()
    const [first, second] = await Promise.all([
      claim(deps, { pin: '1111', name: 'First phone' }),
      claim(deps, { pin: '2222', name: 'Second phone' })
    ])
    expect([first.status, second.status].sort()).toEqual([201, 409])
    expect(parentDeviceCount(db)).toBe(1)
    db.close()
  })
})
