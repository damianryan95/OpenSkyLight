import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { handleApiRequest } from '../../src/server/api/router'
import { DisplayDeviceService, HouseholdAuthService } from '../../src/server/auth'
import { openServerDatabase } from '../../src/server/db'
import { createChoresRewardsService, createDisplayReadService, createHouseholdSettingsService, createListsDomain, createMealsDomain, createPeopleService } from '../../src/server/domain'

const directories: string[] = []

class TestResponse {
  status = 200; body = ''
  setHeader(): this { return this }
  writeHead(status: number): this { this.status = status; return this }
  end(body?: string): this { this.body = body ?? ''; return this }
}

function request(path: string, credential: string, body?: unknown): IncomingMessage {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method: 'POST', url: path, headers: { authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }
  }) as IncomingMessage
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'osl-kiosk-rpc-')); directories.push(directory)
  const database = openServerDatabase(join(directory, 'server.sqlite'))
  const { sqlite } = database
  sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, theme_id, celebration_enabled, celebration_duration_ms, created_at) VALUES ('ava', 'Ava', 'ava', '#E5484D', 'child', 0, 'minecraft', 1, 3000, '2026-06-01T00:00:00.000Z')").run()
  sqlite.prepare("INSERT INTO calendar_sources (id, kind, name, connected_at) VALUES ('source', 'caldav', 'Household', '2026-06-01T00:00:00.000Z')").run()
  sqlite.prepare("INSERT INTO calendars (id, source_id, source_calendar_id, name, color, selected) VALUES ('calendar', 'source', 'family', 'Family', '#0091FF', 1)").run()
  sqlite.prepare("INSERT INTO events (id, calendar_id, source_event_id, title, start_at, end_at, timezone, created_at, updated_at) VALUES ('event', 'calendar', 'event', 'Dinner', '2026-06-02T18:00:00.000Z', '2026-06-02T19:00:00.000Z', 'UTC', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')").run()
  const displays = new DisplayDeviceService(sqlite)
  const credential = displays.register({ name: 'Kitchen' }).credential
  const chores = createChoresRewardsService(sqlite)
  const settings = createHouseholdSettingsService(sqlite); settings.setTimezone('UTC')
  return { database, credential, deps: { auth: new HouseholdAuthService(sqlite), displays, chores, settings, people: createPeopleService(sqlite), displayRead: createDisplayReadService(sqlite, chores), lists: createListsDomain(sqlite), meals: createMealsDomain(sqlite) } }
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('browser kiosk display-read RPC bridge', () => {
  it('provides the server-authoritative household clock to a registered display', async () => {
    const { database, credential, deps } = setup()
    deps.settings.setTimezone('Pacific/Kiritimati')
    const response = new TestResponse()
    await handleApiRequest(
      request('/api/rpc/app%3AgetInfo', credential),
      response as unknown as ServerResponse,
      { ...deps, now: () => new Date('2026-06-10T12:30:00.000Z'), kioskBuildId: 'bundle-9f2c' }
    )
    // `buildId` is what the display compares to decide whether to reload. It
    // is the served bundle's digest, not the release tag, which is `dev` on
    // every Portainer build and so never changed.
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      data: { zone: 'Pacific/Kiritimati', householdDate: '2026-06-11', buildId: 'bundle-9f2c' }
    })
    database.close()
  })

  it('returns protected core reads for a registered display', async () => {
    const { database, credential, deps } = setup()
    const call = async (channel: string, body?: unknown) => {
      const response = new TestResponse()
      await handleApiRequest(request(`/api/rpc/${encodeURIComponent(channel)}`, credential, body), response as unknown as ServerResponse, deps)
      return { status: response.status, data: JSON.parse(response.body) as { ok: boolean; data: unknown } }
    }
    expect((await call('settings:getAll')).data).toMatchObject({ ok: true, data: { defaultView: 'home' } })
    expect((await call('people:list')).data).toMatchObject({ ok: true, data: [{ id: 'ava', name: 'Ava', themeId: 'minecraft', celebrationAssetId: null, celebrationEnabled: true, celebrationDurationMs: 3000 }] })
    // The board's own calendar is seeded from first boot, so a display always
    // sees it alongside whatever the household has connected. `readOnly` now
    // reports whether the *calendar* will accept a write rather than being
    // hardcoded true; whether this client may write is the PIN gate's business.
    expect((await call('calendars:list')).data).toMatchObject({
      ok: true, data: [{ id: 'calendar', readOnly: false }, { id: 'osl-local-calendar', provider: 'local', readOnly: false }]
    })
    // Writable because its calendar is a CalDAV collection that accepts writes.
    // An event on an ICS feed would still report readOnly here.
    expect((await call('events:getOccurrences', { start: '2026-06-01T00:00:00.000Z', end: '2026-06-03T00:00:00.000Z' })).data).toMatchObject({ ok: true, data: [{ title: 'Dinner', readOnly: false }] })
    expect((await call('lists:getAll')).data).toEqual({ ok: true, data: [] })
    database.close()
  })

  it('requires a display credential and refuses every non-chore display mutation', async () => {
    const { database, credential, deps } = setup()
    for (const channel of [
      'settings:set',
      'people:create', 'people:update', 'people:delete',
      'rewards:redeem', 'lists:create', 'lists:update', 'lists:delete',
      'listItems:add', 'listItems:toggle', 'listItems:delete', 'listItems:clearChecked',
      'meals:set', 'home:setLayout'
    ]) {
      const denied = new TestResponse()
      await handleApiRequest(request(`/api/rpc/${encodeURIComponent(channel)}`, credential, {}), denied as unknown as ServerResponse, deps)
      expect(denied.status, channel).toBe(403)
    }
    const anonymous = new TestResponse()
    await handleApiRequest(request('/api/rpc/people%3Alist', ''), anonymous as unknown as ServerResponse, deps)
    expect(anonymous.status).toBe(401)
    database.close()
  })
})
