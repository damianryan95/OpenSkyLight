import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { DisplayDeviceService, HouseholdAuthService } from '../../src/server/auth'
import { handleApiRequest } from '../../src/server/api/router'
import { openServerDatabase } from '../../src/server/db'

const directories: string[] = []
class Response { status = 200; body = ''; setHeader(): this { return this }; writeHead(status: number): this { this.status = status; return this }; end(body?: string): this { this.body = body ?? ''; return this } }
function request(method: string, url: string, headers: Record<string, string>, body?: unknown): IncomingMessage { return Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { method, url, headers }) as IncomingMessage }
async function call(method: string, url: string, headers: Record<string, string>, body: unknown, dependencies: { auth: HouseholdAuthService; displays: DisplayDeviceService }): Promise<Response> { const response = new Response(); await handleApiRequest(request(method, url, headers, body), response as unknown as ServerResponse, dependencies); return response }

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('phone display administration', () => {
  it('keeps two displays independently manageable and never serializes credentials in diagnostics/list payloads', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openskylight-phone-devices-')); directories.push(directory)
    const database = openServerDatabase(join(directory, 'server.sqlite')); const auth = new HouseholdAuthService(database.sqlite); const displays = new DisplayDeviceService(database.sqlite)
    const session = auth.setup('1234'); const headers = { origin: 'http://server.test', host: 'server.test', cookie: `osl_parent_session=${session.sessionToken}`, 'x-osl-csrf-token': session.csrfToken, 'content-type': 'application/json' }; const dependencies = { auth, displays }
    const kitchen = JSON.parse((await call('POST', '/api/v1/displays', headers, { name: 'Kitchen' }, dependencies)).body) as { id: string; credential: string }
    const bedroom = JSON.parse((await call('POST', '/api/v1/displays', headers, { name: 'Bedroom' }, dependencies)).body) as { id: string; credential: string }
    await call('PATCH', `/api/v1/displays/${kitchen.id}`, headers, { name: 'Kitchen wall', themePreference: 'dark', sleepSettings: { enabled: true, start: '21:00', end: '06:30' } }, dependencies)
    const listed = await call('GET', '/api/v1/displays', { cookie: headers.cookie }, undefined, dependencies)
    expect(listed.status).toBe(200); expect(listed.body).toContain('Kitchen wall'); expect(listed.body).toContain('Bedroom'); expect(listed.body).not.toContain(kitchen.credential); expect(listed.body).not.toContain(bedroom.credential)
    expect((await call('POST', `/api/v1/displays/${kitchen.id}/revoke`, headers, undefined, dependencies)).status).toBe(204)
    expect(displays.authenticate(kitchen.credential)).toBeUndefined()
    expect(displays.authenticate(bedroom.credential)).toMatchObject({ id: bedroom.id, name: 'Bedroom' })
    database.close()
  })
})
