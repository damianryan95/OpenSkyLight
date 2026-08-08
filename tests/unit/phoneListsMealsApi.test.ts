import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HouseholdAuthService } from '../../src/server/auth'
import { handleApiRequest, type ApiRouterDependencies } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createListsDomain, createMealsDomain } from '../../src/server/domain'
import { EventStream } from '../../src/server/events'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
class Response { status = 200; body = ''; headers = new Map<string, string>(); setHeader(name: string, value: string): this { this.headers.set(name.toLowerCase(), value); return this }; writeHead(status: number, headers?: Record<string, string>): this { this.status = status; for (const [key, value] of Object.entries(headers ?? {})) this.setHeader(key, value); return this }; end(body?: string): this { this.body = body ?? ''; return this } }
function database(): ServerDatabase { const directory = mkdtempSync(join(tmpdir(), 'osl-planning-api-')); directories.push(directory); return openServerDatabase(join(directory, 'test.db')) }
function request(method: string, url: string, headers: Record<string, string>, body?: unknown): IncomingMessage { return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers }) as IncomingMessage }
async function call(deps: ApiRouterDependencies, method: string, url: string, cookie = '', csrf = '', body?: unknown): Promise<Response> { const response = new Response(); await handleApiRequest(request(method, url, { host: 'server.test', origin: 'http://server.test', cookie, 'x-osl-csrf-token': csrf, 'content-type': 'application/json' }, body), response as unknown as ServerResponse, deps); return response }

describe('phone lists and meals APIs', () => {
  it('requires a parent session for every list and meal command, while retaining display reads separately', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const cookie = `osl_parent_session=${session.sessionToken}`
    const lists = createListsDomain(db.sqlite); const meals = createMealsDomain(db.sqlite); const stream = new EventStream(); const deps = { auth, lists, meals, eventStream: stream }
    expect((await call(deps, 'POST', '/api/v1/lists', '', '', { name: 'Groceries', color: '#46A758', kind: 'grocery' })).status).toBe(401)
    const created = await call(deps, 'POST', '/api/v1/lists', cookie, session.csrfToken, { name: 'Groceries', color: '#46A758', kind: 'grocery' })
    expect(created.status).toBe(201); const list = JSON.parse(created.body) as { id: string; items: unknown[] }; expect(list.items).toEqual([])
    const item = await call(deps, 'POST', `/api/v1/lists/${list.id}/items`, cookie, session.csrfToken, { text: 'Milk' }); expect(item.status).toBe(201)
    expect((await call(deps, 'POST', `/api/v1/list-items/${JSON.parse(item.body).id}/toggle`, cookie, session.csrfToken)).status).toBe(204)
    expect((await call(deps, 'DELETE', `/api/v1/lists/${list.id}/items/checked`, cookie, session.csrfToken)).status).toBe(204)
    expect(JSON.parse((await call(deps, 'GET', '/api/v1/lists', cookie, session.csrfToken)).body)).toEqual({ lists: [expect.objectContaining({ id: list.id, items: [] })] })
    expect((await call(deps, 'PUT', '/api/v1/meals/2026-08-03/dinner', cookie, session.csrfToken, { text: ' Tacos ' })).status).toBe(204)
    expect(JSON.parse((await call(deps, 'GET', '/api/v1/meals?start=2026-08-03&end=2026-08-09', cookie, session.csrfToken)).body)).toEqual({ meals: [{ date: '2026-08-03', slot: 'dinner', text: 'Tacos' }] })
    expect((await call(deps, 'PUT', '/api/v1/meals/2026-08-03/dinner', cookie, session.csrfToken, { text: null })).status).toBe(204)
    expect((await call(deps, 'GET', '/api/v1/meals?start=2026-08-09&end=2026-08-03', cookie, session.csrfToken)).status).toBe(400)
    db.close()
  })

  it('publishes display-query invalidations after parent planning changes', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const cookie = `osl_parent_session=${session.sessionToken}`
    const stream = new EventStream(); const writes: string[] = []; const response = { writeHead: () => undefined, write: (chunk: string) => { writes.push(chunk); return true }, end: () => {}, once: () => undefined }
    stream.connect(response as unknown as ServerResponse, undefined)
    const deps = { auth, lists: createListsDomain(db.sqlite), meals: createMealsDomain(db.sqlite), eventStream: stream }
    await call(deps, 'POST', '/api/v1/lists', cookie, session.csrfToken, { name: 'To-do', color: '#0091FF', kind: 'todo' })
    await call(deps, 'PUT', '/api/v1/meals/2026-08-03/lunch', cookie, session.csrfToken, { text: 'Soup' })
    expect(writes.join('')).toContain('"resources":["lists"]')
    expect(writes.join('')).toContain('"resources":["meals"]')
    db.close()
  })
})
