import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HouseholdAuthService } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createPeopleService } from '../../src/server/domain'
import { createGoogleConnectionService, type GoogleCalendarRemote, type GoogleOAuthClient } from '../../src/server/sync/google'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

class Response {
  status = 200; body = ''; headers = new Map<string, string>()
  setHeader(name: string, value: string): this { this.headers.set(name.toLowerCase(), value); return this }
  writeHead(status: number, headers?: Record<string, string>): this { this.status = status; for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value); return this }
  end(body?: string): this { this.body = body ?? ''; return this }
}

function database(): ServerDatabase { const directory = mkdtempSync(join(tmpdir(), 'osl-phone-api-')); directories.push(directory); return openServerDatabase(join(directory, 'test.db')) }
function request(method: string, url: string, headers: Record<string, string>, body?: unknown): IncomingMessage { return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers }) as IncomingMessage }
async function call(deps: ApiRouterDependencies, method: string, url: string, cookie: string, csrf: string, body?: unknown): Promise<Response> {
  const response = new Response()
  await handleApiRequest(request(method, url, { host: 'server.test', origin: 'http://server.test', cookie, 'x-osl-csrf-token': csrf, 'content-type': 'application/json' }, body), response as unknown as ServerResponse, deps)
  return response
}

describe('phone people and calendar APIs', () => {
  it('requires a parent session, exposes person roles, and reports ambiguous child names', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const cookie = `osl_parent_session=${session.sessionToken}`
    const deps = { auth, people: createPeopleService(db.sqlite) }
    expect((await call(deps, 'GET', '/api/v1/people', '', '')).status).toBe(401)
    const created = await call(deps, 'POST', '/api/v1/people', cookie, session.csrfToken, { name: '  Alex  Kim ', color: '#123456', role: 'child' })
    expect(created.status).toBe(201); expect(JSON.parse(created.body)).toMatchObject({ name: 'Alex Kim', role: 'child' })
    const duplicate = await call(deps, 'POST', '/api/v1/people', cookie, session.csrfToken, { name: 'alex kim', color: '#654321', role: 'child' })
    expect(duplicate.status).toBe(400); expect(duplicate.body).toContain('must be unique')
    db.close()
  })

  it('lists and maps Google calendars to Family or exactly one current person', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const cookie = `osl_parent_session=${session.sessionToken}`
    const people = createPeopleService(db.sqlite); const alex = people.create({ name: 'Alex', color: '#123456', role: 'child' })
    const oauth: GoogleOAuthClient = { authorizationUrl: ({ state }) => `https://accounts.test/consent?state=${state}`, exchangeCode: async () => ({ email: 'parent@example.test', refreshToken: 'refresh-token' }), revoke: async () => undefined }
    const remote: GoogleCalendarRemote = { listCalendars: async () => [{ id: 'family', name: 'Family', color: '#111111', primary: true, readOnly: false }] }
    const google = createGoogleConnectionService(db.sqlite, { householdId: 'household', redirectUri: 'http://server.test/api/v1/google/callback', tokenEncryptionKey: Buffer.alloc(32, 7) }, oauth, remote)
    const scheduler = { syncNow: vi.fn().mockResolvedValue(undefined), start: vi.fn(), stop: vi.fn(), isRunning: vi.fn(() => false) }
    const deps = { auth, people, google, googleSyncScheduler: scheduler }
    const started = await call(deps, 'POST', '/api/v1/google/connect', cookie, session.csrfToken)
    expect(started.status).toBe(201); const state = JSON.parse(started.body).state as string
    const callback = await call(deps, 'GET', `/api/v1/google/callback?state=${encodeURIComponent(state)}&code=ok`, cookie, session.csrfToken)
    expect(callback.status).toBe(302)
    const accountId = google.listAccounts()[0]!.id
    const list = await call(deps, 'GET', `/api/v1/google/accounts/${accountId}/calendars`, cookie, session.csrfToken)
    expect(JSON.parse(list.body).calendars[0]).toMatchObject({ selected: false, audiencePersonId: null })
    const mapped = await call(deps, 'PUT', `/api/v1/google/accounts/${accountId}/calendars`, cookie, session.csrfToken, { calendar: { id: 'family', name: 'Family', color: '#111111', primary: true, readOnly: false }, selected: true, audiencePersonId: alex.id })
    expect(mapped.status).toBe(204)
    expect(scheduler.syncNow).toHaveBeenCalledWith('selection')
    expect((await google.listRemoteCalendars(accountId))[0]).toMatchObject({ selected: true, audiencePersonId: alex.id })
    const sync = await call(deps, 'POST', '/api/v1/google/sync', cookie, session.csrfToken)
    expect(sync.status).toBe(202)
    expect(scheduler.syncNow).toHaveBeenCalledWith('manual')
    db.close()
  })
})
