import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase } from '../../src/server/db'
import { createGoogleConnectionService, type GoogleCalendarRemote, type GoogleOAuthClient } from '../../src/server/sync/google'
import { decryptRefreshToken, encryptRefreshToken } from '../../src/server/sync/google/secrets'
import { createPeopleService } from '../../src/server/domain/people'

const directories: string[] = []
const key = Buffer.alloc(32, 7)
const remoteCalendars = [
  { id: 'family', name: 'Family', color: '#112233', primary: true, readOnly: false },
  { id: 'school', name: 'School', color: '#445566', primary: false, readOnly: true }
]

function database() {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-google-'))
  directories.push(directory)
  return openServerDatabase(join(directory, 'server.sqlite'))
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup(options: { revoked?: boolean } = {}) {
  const db = database()
  let requestedScopes: readonly string[] = []
  const oauth: GoogleOAuthClient = {
    authorizationUrl: ({ state, verifier, scopes }) => { requestedScopes = scopes; return `https://accounts.example.test/auth?state=${state}&challenge=${verifier}` },
    exchangeCode: async ({ code }) => code === 'no-token'
      ? { email: 'parent@example.test', refreshToken: undefined }
      : { email: 'parent@example.test', refreshToken: 'refresh-secret', scopes: ['calendar.readonly'] },
    revoke: async () => undefined
  }
  const remote: GoogleCalendarRemote = {
    listCalendars: async () => {
      if (options.revoked) throw { code: 'invalid_grant' }
      return remoteCalendars
    }
  }
  const service = createGoogleConnectionService(db.sqlite, { householdId: 'household-a', redirectUri: 'https://osl.example.test/admin/google/oauth/callback', tokenEncryptionKey: key }, oauth, remote)
  return { db, service, requestedScopes: () => requestedScopes }
}

async function connect(service: ReturnType<typeof createGoogleConnectionService>) {
  const started = service.startConnection('session-1')
  return service.completeConnection({ parentSessionId: 'session-1', state: started.state, code: 'ok' })
}

describe('headless Google account and calendar discovery', () => {
  it('uses a single-use PKCE state to connect, list several calendars, and map them to Family or a person', async () => {
    const { db, service, requestedScopes } = setup()
    const alice = createPeopleService(db.sqlite).create({ name: 'Alice', color: '#fff', role: 'child' })
    const pending = service.startConnection('session-1')
    expect(requestedScopes()).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'])
    expect(pending.authorizationUrl).toContain(encodeURIComponent(pending.state))
    const account = await service.completeConnection({ parentSessionId: 'session-1', state: pending.state, code: 'ok' })
    await expect(service.completeConnection({ parentSessionId: 'session-1', state: pending.state, code: 'ok' })).rejects.toThrow(/invalid or expired/i)

    const discovered = await service.listRemoteCalendars(account.id)
    expect(discovered).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'family', selected: false, audiencePersonId: null }),
      expect.objectContaining({ id: 'school', selected: false, audiencePersonId: null })
    ]))
    service.setCalendarSelection({ accountId: account.id, calendar: remoteCalendars[0], selected: true, audiencePersonId: null })
    service.setCalendarSelection({ accountId: account.id, calendar: remoteCalendars[1], selected: true, audiencePersonId: alice.id })
    expect(await service.listRemoteCalendars(account.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'family', selected: true, audiencePersonId: null }),
      expect.objectContaining({ id: 'school', selected: true, audiencePersonId: alice.id })
    ]))
    expect(() => service.setCalendarSelection({ accountId: account.id, calendar: remoteCalendars[0], selected: true, audiencePersonId: 'gone' })).toThrow(/person was not found/i)
  })

  it('keeps tokens authenticated, handles reconnection, and reports revoked credentials without exposing the token', async () => {
    const { db, service } = setup({ revoked: true })
    const account = await connect(service)
    const stored = db.sqlite.prepare<[string], { refresh_token_enc: Buffer }>('SELECT refresh_token_enc FROM google_accounts WHERE id = ?').get(account.id)!
    expect(stored.refresh_token_enc.toString()).not.toContain('refresh-secret')
    expect(decryptRefreshToken(key, 'household-a', account.id, stored.refresh_token_enc)).toBe('refresh-secret')
    await expect(service.listRemoteCalendars(account.id)).rejects.toThrow(/revoked or expired/i)
    expect(service.listAccounts()).toEqual([expect.objectContaining({ state: 'reauthorization_required', error: 'reauthorization_required' })])

    const restarted = service.startConnection('session-1')
    await service.completeConnection({ parentSessionId: 'session-1', state: restarted.state, code: 'ok' })
    expect(service.listAccounts()).toEqual([expect.objectContaining({ state: 'connected', error: null })])
  })

  it('cancels attempts and disconnects even when Google revocation fails', async () => {
    const { db } = setup()
    const service = createGoogleConnectionService(db.sqlite, { householdId: 'household-a', redirectUri: 'https://osl.example.test/admin/google/oauth/callback', tokenEncryptionKey: key }, {
      authorizationUrl: () => 'https://accounts.example.test/auth',
      exchangeCode: async () => ({ email: 'parent@example.test', refreshToken: 'refresh-secret' }),
      revoke: async () => { throw new Error('offline') }
    }, { listCalendars: async () => [] })
    const pending = service.startConnection('session-1')
    service.cancelConnection('session-1', pending.state)
    await expect(service.completeConnection({ parentSessionId: 'session-1', state: pending.state, code: 'ok' })).rejects.toThrow(/invalid or expired/i)
    const account = await connect(service)
    await expect(service.disconnect(account.id)).resolves.toEqual({ revocationFailed: true })
    expect(service.listAccounts()).toEqual([])
  })

  it('rejects altered authenticated token envelopes', () => {
    const envelope = encryptRefreshToken(key, 'household-a', 'account-a', 'refresh-secret')
    const tagStart = envelope.indexOf(46, envelope.indexOf(46) + 1) + 1
    envelope[tagStart] = envelope[tagStart] === 65 ? 66 : 65
    expect(() => decryptRefreshToken(key, 'household-a', 'account-a', envelope)).toThrow(/authenticated/i)
  })
})
