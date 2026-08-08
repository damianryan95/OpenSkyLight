import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { createGoogleApiAdapters, createGoogleConnectionService, GoogleConnectionError, type GoogleConnectionService } from './index'
import { createGoogleEventsRemote, createGooglePullSynchronizer, type GooglePullSynchronizer } from './pull'
import type { GoogleSyncStatusService } from './status'
import { decryptRefreshToken, encryptRefreshToken } from './secrets'

export interface GoogleConfigurationStatus { configured: boolean; unlocked: boolean; redirectUri: string | null }
function callbackUri(value: string): string {
  let uri: URL
  try { uri = new URL(value.trim()) } catch { throw new GoogleConnectionError('Google server URL must be a valid HTTPS URL.') }
  const loopbackHttp = uri.protocol === 'http:' && (uri.hostname === 'localhost' || uri.hostname === '127.0.0.1' || uri.hostname === '[::1]')
  if ((uri.protocol !== 'https:' && !loopbackHttp) || uri.username || uri.password || uri.search || uri.hash) throw new GoogleConnectionError('Google server URL must use HTTPS, except for localhost or a loopback IP address.')
  return uri.toString().replace(/\/$/u, '') + '/api/v1/google/callback'
}
type Row = { household_id: string; redirect_uri: string; vault_salt: Buffer; client_id_enc: Buffer; client_secret_enc: Buffer; token_encryption_key_enc: Buffer }

/** Encrypted OAuth configuration using an app-generated private key beside SQLite. */
export class GoogleConfigurationVault {
  private service: GoogleConnectionService | undefined
  private syncCredentials: { householdId: string; clientId: string; clientSecret: string; tokenEncryptionKey: Buffer } | undefined
  constructor(private readonly sqlite: Database.Database) { if (this.row()) this.tryAutomaticUnlock() }
  status(): GoogleConfigurationStatus { const row = this.row(); return { configured: row !== undefined, unlocked: this.service !== undefined, redirectUri: row?.redirect_uri ?? null } }
  configure(input: { clientId: string; clientSecret: string; publicUrl: string }): GoogleConfigurationStatus {
    if (this.row()) {
      const accounts = this.sqlite.prepare('SELECT count(*) AS count FROM google_accounts').get() as { count: number }
      if (accounts.count > 0 && this.service !== undefined) throw new GoogleConnectionError('Disconnect Google accounts before replacing its configuration.')
      this.sqlite.transaction(() => {
        // An inaccessible configuration cannot disconnect through the Google
        // service. Reconfiguration deliberately clears those unusable account
        // records so the parent can reconnect without the former passphrase.
        if (this.service === undefined) this.sqlite.prepare('DELETE FROM google_accounts').run()
        this.sqlite.prepare('DELETE FROM google_configuration WHERE id = 1').run()
      })()
      this.service = undefined
      this.syncCredentials = undefined
    }
    const clientId = input.clientId.trim(); const clientSecret = input.clientSecret.trim()
    if (!clientId || !clientSecret) throw new GoogleConnectionError('Google client ID and client secret are required.')
    const key = this.installationKey(true); const householdId = randomUUID(); const tokenKey = randomBytes(32); const redirectUri = callbackUri(input.publicUrl)
    this.sqlite.prepare(`INSERT INTO google_configuration (id, household_id, redirect_uri, vault_salt, client_id_enc, client_secret_enc, token_encryption_key_enc, configured_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`)
      .run(householdId, redirectUri, Buffer.from('app-key-v1'), encryptRefreshToken(key, householdId, 'client-id', clientId), encryptRefreshToken(key, householdId, 'client-secret', clientSecret), encryptRefreshToken(key, householdId, 'token-key', tokenKey.toString('base64')), new Date().toISOString())
    this.unlockWithKey(key)
    return this.status()
  }
  private unlockWithKey(key: Buffer): void {
    const row = this.row(); if (!row) return
    try {
      const clientId = decryptRefreshToken(key, row.household_id, 'client-id', row.client_id_enc); const clientSecret = decryptRefreshToken(key, row.household_id, 'client-secret', row.client_secret_enc)
      const tokenKey = Buffer.from(decryptRefreshToken(key, row.household_id, 'token-key', row.token_encryption_key_enc), 'base64')
      if (tokenKey.length !== 32) throw new Error('invalid token key')
      const adapters = createGoogleApiAdapters(clientId, clientSecret)
      this.service = createGoogleConnectionService(this.sqlite, { householdId: row.household_id, redirectUri: row.redirect_uri, tokenEncryptionKey: tokenKey }, adapters.oauth, adapters.remote)
      this.syncCredentials = { householdId: row.household_id, clientId, clientSecret, tokenEncryptionKey: tokenKey }
    } catch { this.service = undefined; this.syncCredentials = undefined; throw new GoogleConnectionError('Stored Google configuration could not be decrypted.') }
  }
  get(): GoogleConnectionService | undefined { return this.service }
  getPullSynchronizer(householdTimezone: () => string, status: GoogleSyncStatusService): GooglePullSynchronizer | undefined {
    const credentials = this.syncCredentials
    if (!credentials) return undefined
    return createGooglePullSynchronizer(this.sqlite, createGoogleEventsRemote({ sqlite: this.sqlite, ...credentials }), householdTimezone, status)
  }
  private row(): Row | undefined { return this.sqlite.prepare('SELECT household_id, redirect_uri, vault_salt, client_id_enc, client_secret_enc, token_encryption_key_enc FROM google_configuration WHERE id = 1').get() as Row | undefined }
  private tryAutomaticUnlock(): void { try { this.unlockWithKey(this.installationKey(false)) } catch { this.service = undefined } }
  private installationKey(create: boolean): Buffer {
    const databaseName = this.sqlite.name
    if (!databaseName || databaseName === ':memory:') throw new GoogleConnectionError('Google configuration requires a persistent SQLite database.')
    const path = `${databaseName}.google-key`
    try {
      const key = readFileSync(path)
      if (key.length !== 32) throw new Error('invalid key')
      return key
    } catch {
      if (!create) throw new GoogleConnectionError('Google application key is unavailable.')
      const key = randomBytes(32)
      writeFileSync(path, key, { flag: 'wx', mode: 0o600 })
      chmodSync(path, 0o600)
      return key
    }
  }
}
