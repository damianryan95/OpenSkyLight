import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { calendar as createCalendarClient } from '@googleapis/calendar'
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import { decryptRefreshToken, encryptRefreshToken } from './secrets'
export { createGoogleSyncStatusService, GOOGLE_SYNC_STALE_AFTER_MS, type GoogleSyncStatusService } from './status'

const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const GOOGLE_CONNECTION_SCOPES = ['openid', 'email', CALENDAR_READ_SCOPE] as const
const ATTEMPT_TTL_MS = 10 * 60 * 1000

export type GoogleAccountState = 'connected' | 'reauthorization_required'

export interface GoogleOAuthClient {
  authorizationUrl(input: { redirectUri: string; state: string; verifier: string; scopes: readonly string[] }): string
  exchangeCode(input: { code: string; redirectUri: string; verifier: string }): Promise<{
    email: string
    refreshToken: string | undefined
    scopes?: readonly string[]
  }>
  revoke(refreshToken: string): Promise<void>
}

export interface GoogleCalendarRemote {
  listCalendars(input: { accountId: string; refreshToken: string }): Promise<readonly RemoteCalendar[]>
}

export interface RemoteCalendar {
  id: string
  name: string
  color: string
  primary: boolean
  readOnly: boolean
}

export interface GoogleConnectionConfig {
  householdId: string
  redirectUri: string
  tokenEncryptionKey: Buffer
}

/** Concrete Google adapter. Its caller obtains the Web-client secret from an operator-mounted secret. */
export function createGoogleApiAdapters(clientId: string, clientSecret: string): { oauth: GoogleOAuthClient; remote: GoogleCalendarRemote } {
  const configuredClientId = requireText(clientId, 'Google client ID')
  const configuredClientSecret = requireText(clientSecret, 'Google client secret')
  const oauth: GoogleOAuthClient = {
    authorizationUrl: ({ redirectUri, state, verifier, scopes }) => {
      const client = new OAuth2Client({ clientId: configuredClientId, clientSecret: configuredClientSecret, redirectUri })
      const challenge = b64url(createHash('sha256').update(verifier).digest())
      return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [...scopes], state, code_challenge_method: CodeChallengeMethod.S256, code_challenge: challenge })
    },
    async exchangeCode({ code, redirectUri, verifier }) {
      const client = new OAuth2Client({ clientId: configuredClientId, clientSecret: configuredClientSecret, redirectUri })
      const { tokens } = await client.getToken({ code, codeVerifier: verifier, redirect_uri: redirectUri })
      if (!tokens.access_token) throw new GoogleConnectionError('Google authorization did not return an access token.')
      const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })
      if (!response.ok) throw new GoogleConnectionError('Google account identity could not be verified.')
      const profile = await response.json() as { email?: string }
      return { email: profile.email ?? '', refreshToken: tokens.refresh_token ?? undefined, scopes: tokens.scope?.split(' ') }
    },
    async revoke(refreshToken) {
      const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' })
      if (!response.ok) throw new GoogleConnectionError('Google token revocation failed.')
    }
  }
  const remote: GoogleCalendarRemote = {
    async listCalendars({ refreshToken }) {
      const client = new OAuth2Client({ clientId: configuredClientId, clientSecret: configuredClientSecret })
      client.setCredentials({ refresh_token: refreshToken })
      // @googleapis/calendar bundles a nominally distinct google-auth-library version.
      const response = await createCalendarClient({ version: 'v3', auth: client as unknown as Parameters<typeof createCalendarClient>[0]['auth'] }).calendarList.list({ maxResults: 250 })
      return (response.data.items ?? []).filter((item) => item.id && (item.summaryOverride ?? item.summary)).map((item) => ({
        id: item.id!, name: item.summaryOverride ?? item.summary!, color: item.backgroundColor ?? '#0091FF',
        primary: item.primary ?? false, readOnly: item.accessRole !== 'owner' && item.accessRole !== 'writer'
      }))
    }
  }
  return { oauth, remote }
}

export interface GoogleAccount {
  id: string
  email: string
  state: GoogleAccountState
  error: string | null
  connectedAt: string
}

export interface DiscoveredCalendar extends RemoteCalendar {
  selected: boolean
  audiencePersonId: string | null
}

export class GoogleConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleConnectionError'
  }
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function b64url(value: Buffer): string {
  return value.toString('base64url')
}

function requireText(value: string, field: string): string {
  const result = value.trim()
  if (!result) throw new GoogleConnectionError(`${field} is required.`)
  return result
}

function toAccount(row: { id: string; email: string; auth_state: GoogleAccountState; last_refresh_error: string | null; connected_at: string }): GoogleAccount {
  return { id: row.id, email: row.email, state: row.auth_state, error: row.last_refresh_error, connectedAt: row.connected_at }
}

/**
 * Transport-neutral Google connection and calendar-selection service. HTTP
 * handlers supply parent-session authorization and invoke these operations.
 */
export function createGoogleConnectionService(
  sqlite: Database.Database,
  config: GoogleConnectionConfig,
  oauth: GoogleOAuthClient,
  remote: GoogleCalendarRemote,
  now: () => Date = () => new Date()
) {
  if (config.tokenEncryptionKey.length !== 32) throw new GoogleConnectionError('Google token encryption key must be 32 bytes.')
  requireText(config.householdId, 'Household ID')
  requireText(config.redirectUri, 'Google redirect URI')

  function startConnection(parentSessionId: string): { authorizationUrl: string; state: string; expiresAt: string } {
    const sessionId = requireText(parentSessionId, 'Parent session')
    const state = b64url(randomBytes(32))
    const verifier = b64url(randomBytes(32))
    const createdAt = now().toISOString()
    const expiresAt = new Date(now().getTime() + ATTEMPT_TTL_MS).toISOString()
    sqlite.prepare(`DELETE FROM google_oauth_attempts WHERE expires_at <= ? OR consumed_at IS NOT NULL`).run(createdAt)
    sqlite.prepare(`
      INSERT INTO google_oauth_attempts (id, state_hash, parent_session_hash, pkce_verifier, scopes, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), hash(state), hash(sessionId), verifier, GOOGLE_CONNECTION_SCOPES.join(' '), expiresAt, createdAt)
    return {
      authorizationUrl: oauth.authorizationUrl({ redirectUri: config.redirectUri, state, verifier, scopes: GOOGLE_CONNECTION_SCOPES }),
      state,
      expiresAt
    }
  }

  async function completeConnection(input: { parentSessionId: string; state: string; code: string }): Promise<GoogleAccount> {
    const parentSessionId = requireText(input.parentSessionId, 'Parent session')
    const state = requireText(input.state, 'OAuth state')
    const code = requireText(input.code, 'Authorization code')
    const attempt = sqlite.prepare<[Buffer, Buffer], { id: string; pkce_verifier: string; expires_at: string; consumed_at: string | null }>(`
      SELECT id, pkce_verifier, expires_at, consumed_at FROM google_oauth_attempts
      WHERE state_hash = ? AND parent_session_hash = ?
    `).get(hash(state), hash(parentSessionId))
    if (!attempt || attempt.consumed_at || Date.parse(attempt.expires_at) <= now().getTime()) {
      if (attempt && !attempt.consumed_at) sqlite.prepare('UPDATE google_oauth_attempts SET consumed_at = ? WHERE id = ?').run(now().toISOString(), attempt.id)
      throw new GoogleConnectionError('Google authorization attempt is invalid or expired. Please retry.')
    }
    try {
      const grant = await oauth.exchangeCode({ code, redirectUri: config.redirectUri, verifier: attempt.pkce_verifier })
      const email = requireText(grant.email, 'Google account email')
      if (!grant.refreshToken) throw new GoogleConnectionError('Google did not return an offline refresh token. Please retry with consent.')
      const account = sqlite.prepare<[string], { id: string }>('SELECT id FROM google_accounts WHERE email = ?').get(email)
      const id = account?.id ?? randomUUID()
      const encrypted = encryptRefreshToken(config.tokenEncryptionKey, config.householdId, id, grant.refreshToken)
      const timestamp = now().toISOString()
      sqlite.transaction(() => {
        sqlite.prepare('UPDATE google_oauth_attempts SET consumed_at = ? WHERE id = ?').run(timestamp, attempt.id)
        if (account) {
          sqlite.prepare(`UPDATE google_accounts SET refresh_token_enc = ?, scopes = ?, connected_at = ?, last_refresh_error = NULL,
            last_refreshed_at = ?, auth_state = 'connected' WHERE id = ?`).run(encrypted, (grant.scopes ?? GOOGLE_CONNECTION_SCOPES).join(' '), timestamp, timestamp, id)
        } else {
          sqlite.prepare(`INSERT INTO google_accounts (id, email, refresh_token_enc, scopes, connected_at, last_refreshed_at, auth_state)
            VALUES (?, ?, ?, ?, ?, ?, 'connected')`).run(id, email, encrypted, (grant.scopes ?? GOOGLE_CONNECTION_SCOPES).join(' '), timestamp, timestamp)
        }
      })()
      return getAccount(id)
    } catch (error) {
      sqlite.prepare('UPDATE google_oauth_attempts SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(now().toISOString(), attempt.id)
      if (error instanceof GoogleConnectionError) throw error
      throw new GoogleConnectionError('Google authorization could not be completed. Please retry.')
    }
  }

  function cancelConnection(parentSessionId: string, state: string): void {
    const result = sqlite.prepare('DELETE FROM google_oauth_attempts WHERE state_hash = ? AND parent_session_hash = ? AND consumed_at IS NULL').run(hash(requireText(state, 'OAuth state')), hash(requireText(parentSessionId, 'Parent session')))
    if (result.changes === 0) throw new GoogleConnectionError('Google authorization attempt is not active.')
  }

  function getAccount(id: string): GoogleAccount {
    const row = sqlite.prepare<[string], { id: string; email: string; auth_state: GoogleAccountState; last_refresh_error: string | null; connected_at: string }>(
      'SELECT id, email, auth_state, last_refresh_error, connected_at FROM google_accounts WHERE id = ?'
    ).get(id)
    if (!row) throw new GoogleConnectionError('Google account was not found.')
    return toAccount(row)
  }

  function listAccounts(): GoogleAccount[] {
    return sqlite.prepare<[], { id: string; email: string; auth_state: GoogleAccountState; last_refresh_error: string | null; connected_at: string }>(
      'SELECT id, email, auth_state, last_refresh_error, connected_at FROM google_accounts ORDER BY connected_at ASC'
    ).all().map(toAccount)
  }

  async function listRemoteCalendars(accountId: string): Promise<DiscoveredCalendar[]> {
    const account = sqlite.prepare<[string], { refresh_token_enc: Buffer; auth_state: GoogleAccountState }>('SELECT refresh_token_enc, auth_state FROM google_accounts WHERE id = ?').get(accountId)
    if (!account) throw new GoogleConnectionError('Google account was not found.')
    if (account.auth_state === 'reauthorization_required') throw new GoogleConnectionError('Google account requires reauthorization.')
    let calendars: readonly RemoteCalendar[]
    try {
      calendars = await remote.listCalendars({ accountId, refreshToken: decryptRefreshToken(config.tokenEncryptionKey, config.householdId, accountId, account.refresh_token_enc) })
    } catch (error) {
      if (isRevokedCredential(error)) {
        sqlite.prepare("UPDATE google_accounts SET auth_state = 'reauthorization_required', last_refresh_error = ? WHERE id = ?").run('reauthorization_required', accountId)
        throw new GoogleConnectionError('Google credentials were revoked or expired. Reconnect this account.')
      }
      throw new GoogleConnectionError('Google calendars could not be reached. Existing selections remain available.')
    }
    const mappings = sqlite.prepare<[string], { google_calendar_id: string; selected: number; audience_person_id: string | null }>(
      'SELECT google_calendar_id, selected, audience_person_id FROM calendars WHERE google_account_id = ? AND deleted_at IS NULL'
    ).all(accountId)
    const byRemoteId = new Map(mappings.map((mapping) => [mapping.google_calendar_id, mapping]))
    return calendars.map((calendar) => ({ ...calendar, selected: byRemoteId.get(calendar.id)?.selected === 1, audiencePersonId: byRemoteId.get(calendar.id)?.audience_person_id ?? null }))
  }

  function setCalendarSelection(input: { accountId: string; calendar: RemoteCalendar; selected: boolean; audiencePersonId: string | null }): void {
    getAccount(input.accountId)
    requireText(input.calendar.id, 'Google calendar ID')
    requireText(input.calendar.name, 'Google calendar name')
    if (input.audiencePersonId) {
      const person = sqlite.prepare<[string], { id: string }>('SELECT id FROM people WHERE id = ? AND deleted_at IS NULL').get(input.audiencePersonId)
      if (!person) throw new GoogleConnectionError('Calendar audience person was not found.')
    }
    const current = sqlite.prepare<[string, string], { id: string }>('SELECT id FROM calendars WHERE google_account_id = ? AND google_calendar_id = ?').get(input.accountId, input.calendar.id)
    if (current) {
      sqlite.prepare(`UPDATE calendars SET name = ?, color = ?, selected = ?, audience_person_id = ?, deleted_at = NULL WHERE id = ?`).run(
        input.calendar.name, input.calendar.color, input.selected ? 1 : 0, input.audiencePersonId, current.id
      )
    } else {
      sqlite.prepare(`INSERT INTO calendars (id, google_account_id, google_calendar_id, audience_person_id, name, color, selected)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.accountId, input.calendar.id, input.audiencePersonId, input.calendar.name, input.calendar.color, input.selected ? 1 : 0)
    }
  }

  async function disconnect(accountId: string): Promise<{ revocationFailed: boolean }> {
    const account = sqlite.prepare<[string], { refresh_token_enc: Buffer }>('SELECT refresh_token_enc FROM google_accounts WHERE id = ?').get(accountId)
    if (!account) throw new GoogleConnectionError('Google account was not found.')
    let revocationFailed = false
    try {
      await oauth.revoke(decryptRefreshToken(config.tokenEncryptionKey, config.householdId, accountId, account.refresh_token_enc))
    } catch {
      revocationFailed = true
    }
    sqlite.prepare('DELETE FROM google_accounts WHERE id = ?').run(accountId)
    return { revocationFailed }
  }

  function markRefreshResult(accountId: string, result: { replacementRefreshToken?: string; error?: 'reauthorization_required' | 'transient' }): void {
    getAccount(accountId)
    const timestamp = now().toISOString()
    if (result.replacementRefreshToken) {
      sqlite.prepare(`UPDATE google_accounts SET refresh_token_enc = ?, auth_state = 'connected', last_refresh_error = NULL, last_refreshed_at = ? WHERE id = ?`).run(
        encryptRefreshToken(config.tokenEncryptionKey, config.householdId, accountId, result.replacementRefreshToken), timestamp, accountId
      )
      return
    }
    if (result.error === 'reauthorization_required') {
      sqlite.prepare("UPDATE google_accounts SET auth_state = 'reauthorization_required', last_refresh_error = ? WHERE id = ?").run('reauthorization_required', accountId)
    } else if (result.error === 'transient') {
      sqlite.prepare('UPDATE google_accounts SET last_refresh_error = ? WHERE id = ?').run('transient_error', accountId)
    }
  }

  return { startConnection, completeConnection, cancelConnection, listAccounts, listRemoteCalendars, setCalendarSelection, disconnect, markRefreshResult }
}

export type GoogleConnectionService = ReturnType<typeof createGoogleConnectionService>

function isRevokedCredential(error: unknown): boolean {
  const value = error as { code?: string; status?: number; response?: { data?: { error?: string } } }
  return value?.code === 'invalid_grant' || value?.response?.data?.error === 'invalid_grant' || value?.status === 401
}

export * from './secrets'
export * from './eventMap'
export * from './pull'
export * from './scheduler'
export * from './configuration'
