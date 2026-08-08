import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { DisplayDeviceService, HouseholdAuthService } from '../../src/server/auth'
import { handleApiRequest } from '../../src/server/api/router'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createChoresRewardsService, createHouseholdSettingsService } from '../../src/server/domain'

const directories: string[] = []

function database(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-display-chores-'))
  directories.push(directory)
  const db = openServerDatabase(join(directory, 'openskylight.db'))
  db.sqlite.prepare("INSERT INTO people (id, name, color, role, created_at) VALUES ('child-1', 'Ari', '#fff', 'child', '2026-06-01T00:00:00.000Z')").run()
  return db
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

class TestResponse {
  status = 200; body = ''
  setHeader(): this { return this }
  writeHead(status: number): this { this.status = status; return this }
  end(body?: string): this { this.body = body ?? ''; return this }
}

function request(method: string, path: string, headers: Record<string, string>, body?: unknown): IncomingMessage {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url: path, headers }) as IncomingMessage
}

function dependencies(db: ServerDatabase, published: unknown[] = []) {
  const displays = new DisplayDeviceService(db.sqlite)
  const auth = new HouseholdAuthService(db.sqlite)
  const settings = createHouseholdSettingsService(db.sqlite)
  settings.setTimezone('Pacific/Kiritimati')
  const chores = createChoresRewardsService(db.sqlite, () => '2026-06-10T12:00:00.000Z', (event) => published.push(event))
  return { auth, displays, settings, chores, now: () => new Date('2026-06-10T12:30:00.000Z') }
}

async function call(method: string, path: string, headers: Record<string, string>, body: unknown, deps: ReturnType<typeof dependencies>): Promise<TestResponse> {
  const response = new TestResponse()
  await handleApiRequest(request(method, path, headers, body), response as unknown as ServerResponse, deps)
  return response
}

describe('display chore commands', () => {
  it('uses the authoritative household timezone and only permits today complete/undo', async () => {
    const db = database(); const deps = dependencies(db)
    const credential = deps.displays.register({ name: 'Kitchen' }).credential
    const choreId = deps.chores.createChore({ title: 'Feed cat', personId: 'child-1', starsValue: 2, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY' })
    const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }
    const path = `/api/v1/display/chores/${choreId}/completion`
    // 12:30 UTC is already June 11 in Pacific/Kiritimati.
    expect((await call('POST', path, headers, { dueDate: '2026-06-10' }, deps)).status).toBe(400)
    expect(JSON.parse((await call('POST', path, headers, { dueDate: '2026-06-11' }, deps)).body)).toMatchObject({ created: true, balance: 2 })
    expect(JSON.parse((await call('DELETE', path, headers, { dueDate: '2026-06-11' }, deps)).body)).toMatchObject({ created: true, balance: 0 })
    db.close()
  })

  it('is idempotent, never double-awards, and publishes only after the committed completion', async () => {
    const db = database(); const published: unknown[] = []; const deps = dependencies(db, published)
    const credential = deps.displays.register({ name: 'Kitchen' }).credential
    const choreId = deps.chores.createChore({ title: 'Make bed', personId: 'child-1', starsValue: 3, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY' })
    const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }; const path = `/api/v1/display/chores/${choreId}/completion`
    expect(JSON.parse((await call('POST', path, headers, { dueDate: '2026-06-11' }, deps)).body)).toMatchObject({ created: true, balance: 3 })
    expect(JSON.parse((await call('POST', path, headers, { dueDate: '2026-06-11' }, deps)).body)).toMatchObject({ created: false, balance: 3 })
    expect(db.sqlite.prepare("SELECT count(*) AS count FROM star_ledger WHERE reason = 'chore'").get()).toEqual({ count: 1 })
    expect(published).toEqual([expect.objectContaining({ type: 'chore.completed', choreId })])
    db.close()
  })

  it('requires a registered display credential and rejects other methods', async () => {
    const db = database(); const deps = dependencies(db)
    const session = deps.auth.setup('1234')
    const choreId = deps.chores.createChore({ title: 'Brush teeth', personId: 'child-1', starsValue: 1, dueDate: '2026-06-01', scheduleRrule: 'FREQ=DAILY' })
    const path = `/api/v1/display/chores/${choreId}/completion`
    expect((await call('POST', path, { authorization: `Bearer ${session.sessionToken}`, 'content-type': 'application/json' }, { dueDate: '2026-06-11' }, deps)).status).toBe(401)
    expect((await call('PATCH', path, {}, undefined, deps)).status).toBe(405)
    db.close()
  })
})
