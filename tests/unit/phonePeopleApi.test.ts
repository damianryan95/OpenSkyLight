import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HouseholdAuthService } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createPeopleService } from '../../src/server/domain'

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

describe('phone people APIs', () => {
  it('requires a parent session, exposes person roles, and reports ambiguous child names', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const cookie = `osl_parent_session=${session.sessionToken}`
    const deps = { auth, people: createPeopleService(db.sqlite) }
    expect((await call(deps, 'GET', '/api/v1/people', '', '')).status).toBe(401)
    const created = await call(deps, 'POST', '/api/v1/people', cookie, session.csrfToken, { name: '  Alex  Kim ', color: '#123456', role: 'child' })
    expect(created.status).toBe(201); expect(JSON.parse(created.body)).toMatchObject({ name: 'Alex Kim', role: 'child', themeId: null, celebrationAssetId: null, celebrationEnabled: true, celebrationDurationMs: 3000 })
    const duplicate = await call(deps, 'POST', '/api/v1/people', cookie, session.csrfToken, { name: 'alex kim', color: '#654321', role: 'child' })
    expect(duplicate.status).toBe(400); expect(duplicate.body).toContain('must be unique')
    db.close()
  })

  it('validates person personalization fields through the parent-only API', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const cookie = `osl_parent_session=${session.sessionToken}`
    const people = createPeopleService(db.sqlite); const ava = people.create({ name: 'Ava', color: '#123456', role: 'child' })
    const deps = { auth, people }
    const updated = await call(deps, 'PATCH', `/api/v1/people/${ava.id}`, cookie, session.csrfToken, { themeId: 'frozen', celebrationEnabled: false, celebrationDurationMs: 4500 })
    expect(updated.status).toBe(200); expect(JSON.parse(updated.body)).toMatchObject({ themeId: 'frozen', celebrationEnabled: false, celebrationDurationMs: 4500 })
    const unknownTheme = await call(deps, 'PATCH', `/api/v1/people/${ava.id}`, cookie, session.csrfToken, { themeId: 'not-a-theme' })
    expect(unknownTheme.status).toBe(400); expect(unknownTheme.body).toContain('Invalid enum value')
    const tooFast = await call(deps, 'PATCH', `/api/v1/people/${ava.id}`, cookie, session.csrfToken, { celebrationDurationMs: 1499 })
    expect(tooFast.status).toBe(400); expect(tooFast.body).toContain('greater than or equal to 1500')
    const missingAsset = await call(deps, 'PATCH', `/api/v1/people/${ava.id}`, cookie, session.csrfToken, { celebrationAssetId: 'missing' })
    expect(missingAsset.status).toBe(400); expect(missingAsset.body).toContain('Celebration asset not found.')
    db.close()
  })

})
