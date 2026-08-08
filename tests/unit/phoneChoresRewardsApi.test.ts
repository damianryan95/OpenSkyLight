import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { HouseholdAuthService } from '../../src/server/auth'
import { handleApiRequest } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createChoresRewardsService } from '../../src/server/domain'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
class Response { status = 200; body = ''; setHeader(): this { return this }; writeHead(status: number): this { this.status = status; return this }; end(body?: string): this { this.body = body ?? ''; return this } }
function database(): ServerDatabase { const directory = mkdtempSync(join(tmpdir(), 'osl-phone-chores-')); directories.push(directory); const db = openServerDatabase(join(directory, 'test.db')); db.sqlite.prepare("INSERT INTO people (id, name, color, role, created_at) VALUES ('child-1', 'Ari', '#fff', 'child', '2026-01-01T00:00:00.000Z')").run(); return db }
function request(method: string, url: string, headers: Record<string, string>, body?: unknown): IncomingMessage { return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers }) as IncomingMessage }
async function call(deps: { auth: HouseholdAuthService; chores: ReturnType<typeof createChoresRewardsService> }, method: string, url: string, cookie = '', csrf = '', body?: unknown): Promise<Response> { const response = new Response(); await handleApiRequest(request(method, url, { host: 'server.test', origin: 'http://server.test', cookie, 'x-osl-csrf-token': csrf, 'content-type': 'application/json' }, body), response as unknown as ServerResponse, deps); return response }

describe('phone chores and rewards administration API', () => {
  it('requires a parent session and supports a recurring chore plus historical correction without corrupting its ledger', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const deps = { auth, chores: createChoresRewardsService(db.sqlite, () => '2026-06-10T10:00:00.000Z') }; const cookie = `osl_parent_session=${session.sessionToken}`
    expect((await call(deps, 'POST', '/api/v1/chores', '', '', { title: 'Bed', personId: 'child-1', starsValue: 2, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY', routine: null })).status).toBe(401)
    const created = await call(deps, 'POST', '/api/v1/chores', cookie, session.csrfToken, { title: 'Bed', icon: 'bed', personId: 'child-1', starsValue: 2, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY', routine: 'morning' })
    expect(created.status).toBe(201); const choreId = JSON.parse(created.body).id as string
    expect(JSON.parse(created.body).routine).toBe('morning')
    expect(JSON.parse(created.body).icon).toBe('bed')
    expect((await call(deps, 'POST', `/api/v1/chores/${choreId}/completion`, cookie, session.csrfToken, { dueDate: '2026-06-03' })).status).toBe(200)
    expect((await call(deps, 'DELETE', `/api/v1/chores/${choreId}/completion`, cookie, session.csrfToken, { dueDate: '2026-06-03' })).status).toBe(200)
    expect(db.sqlite.prepare('SELECT count(*) AS count FROM chore_completions').get()).toEqual({ count: 0 })
    expect(db.sqlite.prepare('SELECT count(*) AS count FROM star_ledger').get()).toEqual({ count: 0 })
    expect((await call(deps, 'DELETE', `/api/v1/chores/${choreId}`, cookie, session.csrfToken)).status).toBe(204)
    expect(JSON.parse((await call(deps, 'GET', '/api/v1/chores', cookie, session.csrfToken)).body).chores).toEqual([])
    db.close()
  })

  it('creates, archives, redeems and grants rewards while retaining ledger entries', async () => {
    const db = database(); const auth = new HouseholdAuthService(db.sqlite); const session = auth.setup('1234'); const deps = { auth, chores: createChoresRewardsService(db.sqlite, () => '2026-06-10T10:00:00.000Z') }; const cookie = `osl_parent_session=${session.sessionToken}`
    await call(deps, 'POST', '/api/v1/stars/adjustments', cookie, session.csrfToken, { personId: 'child-1', delta: 10 })
    const created = await call(deps, 'POST', '/api/v1/rewards', cookie, session.csrfToken, { title: 'Movie', costStars: 5 }); const rewardId = JSON.parse(created.body).id as string
    expect((await call(deps, 'POST', `/api/v1/rewards/${rewardId}/redeem`, cookie, session.csrfToken, { personId: 'child-1' })).status).toBe(201)
    const redemptionId = JSON.parse((await call(deps, 'GET', '/api/v1/reward-redemptions', cookie, session.csrfToken)).body).redemptions[0].id as string
    expect((await call(deps, 'POST', `/api/v1/reward-redemptions/${redemptionId}/grant`, cookie, session.csrfToken)).status).toBe(204)
    expect((await call(deps, 'DELETE', `/api/v1/rewards/${rewardId}`, cookie, session.csrfToken)).status).toBe(204)
    expect(db.sqlite.prepare("SELECT reason, delta FROM star_ledger ORDER BY rowid").all()).toEqual([{ reason: 'manual_adjust', delta: 10 }, { reason: 'redemption', delta: -5 }])
    db.close()
  })
})
