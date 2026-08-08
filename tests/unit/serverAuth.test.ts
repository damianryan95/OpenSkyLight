import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HouseholdAuthService } from '../../src/server/auth'
import { handleApiRequest } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'

const temporaryDirectories: string[] = []

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-auth-'))
  temporaryDirectories.push(directory)
  return openServerDatabase(join(directory, 'openskylight.db'))
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class TestClock {
  constructor(private value = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date { return new Date(this.value) }
  advance(milliseconds: number): void { this.value = new Date(this.value.getTime() + milliseconds) }
}

class TestResponse {
  status = 200
  readonly headers = new Map<string, string>()
  body = ''
  setHeader(name: string, value: string): this { this.headers.set(name.toLowerCase(), value); return this }
  writeHead(status: number, headers?: Record<string, string>): this {
    this.status = status
    for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value)
    return this
  }
  end(body?: string): this { this.body = body ?? ''; return this }
}

function request(method: string, path: string, headers: Record<string, string>, body?: unknown): IncomingMessage {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url: path, headers }) as IncomingMessage
}

describe('household PIN sessions', () => {
  it('stores only a salted slow hash, expires sessions, and invalidates every session after a PIN change', () => {
    const db = database()
    const clock = new TestClock()
    const auth = new HouseholdAuthService(db.sqlite, clock)
    const first = auth.setup('1234')
    const second = auth.login('1234')

    const stored = db.sqlite.prepare('SELECT pin_hash FROM household_auth WHERE id = 1').get() as { pin_hash: string }
    expect(stored.pin_hash).toMatch(/^scrypt\$16384\$8\$1\$/)
    expect(stored.pin_hash).not.toContain('1234')
    expect(auth.getParentSession(first.sessionToken)).toMatchObject({ expiresAt: expect.any(String) })

    auth.changePin(first.sessionToken, first.csrfToken, '5678')
    expect(auth.getParentSession(first.sessionToken)).toBeUndefined()
    expect(auth.getParentSession(second.sessionToken)).toBeUndefined()
    expect(() => auth.login('1234')).toThrow(/Invalid household PIN/)
    expect(auth.login('5678').sessionToken).toEqual(expect.any(String))

    const expiring = auth.login('5678')
    clock.advance(8 * 60 * 60 * 1000 + 1)
    expect(auth.getParentSession(expiring.sessionToken)).toBeUndefined()
    db.close()
  })

  it('backs off brute-force attempts and resets the throttle after a successful login', () => {
    const db = database()
    const clock = new TestClock()
    const auth = new HouseholdAuthService(db.sqlite, clock)
    auth.setup('1234')
    for (let attempt = 0; attempt < 4; attempt += 1) expect(() => auth.login('9999')).toThrow()
    try {
      auth.login('1234')
      throw new Error('Expected throttling')
    } catch (error) {
      expect(error).toMatchObject({ code: 'rate_limited', retryAfterSeconds: expect.any(Number) })
    }
    clock.advance(1_000)
    expect(auth.login('1234').sessionToken).toEqual(expect.any(String))
    db.close()
  })

  it('requires same-origin CSRF-protected requests and sends an HttpOnly SameSite session cookie', async () => {
    const db = database()
    const auth = new HouseholdAuthService(db.sqlite)
    const headers = { origin: 'http://server.test', host: 'server.test', 'content-type': 'application/json' }
    const setup = new TestResponse()
    await handleApiRequest(request('POST', '/api/v1/auth/setup', headers, { pin: '1234' }), setup as unknown as ServerResponse, { auth })
    expect(setup.status).toBe(201)
    const setupBody = JSON.parse(setup.body) as { csrfToken: string }
    const setCookie = setup.headers.get('set-cookie')!
    const cookie = setCookie.split(';')[0]
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    const missingCsrf = new TestResponse()
    await handleApiRequest(request('POST', '/api/v1/auth/logout', { origin: 'http://server.test', host: 'server.test', cookie }), missingCsrf as unknown as ServerResponse, { auth })
    expect(missingCsrf.status).toBe(403)
    const wrongOrigin = new TestResponse()
    await handleApiRequest(request('POST', '/api/v1/auth/logout', { origin: 'http://attacker.test', host: 'server.test', cookie, 'x-osl-csrf-token': setupBody.csrfToken }), wrongOrigin as unknown as ServerResponse, { auth })
    expect(wrongOrigin.status).toBe(403)
    const change = new TestResponse()
    await handleApiRequest(request('PUT', '/api/v1/auth/pin', { ...headers, cookie, 'x-osl-csrf-token': setupBody.csrfToken }, { newPin: '5678' }), change as unknown as ServerResponse, { auth })
    expect(change.status).toBe(204)
    expect(change.headers.get('set-cookie')).toContain('Max-Age=0')
    db.close()
  })
})
