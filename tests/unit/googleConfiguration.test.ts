import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase } from '../../src/server/db'
import { GoogleConfigurationVault } from '../../src/server/sync/google'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('Google configuration vault', () => {
  it('encrypts OAuth configuration and unlocks automatically after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'osl-google-config-')); directories.push(directory)
    const path = join(directory, 'test.db'); const first = openServerDatabase(path)
    const vault = new GoogleConfigurationVault(first.sqlite)
    expect(vault.status()).toEqual({ configured: false, unlocked: false, redirectUri: null })
    expect(vault.configure({ clientId: 'client-id', clientSecret: 'client-secret', publicUrl: 'https://osl.example.test/' }))
      .toEqual({ configured: true, unlocked: true, redirectUri: 'https://osl.example.test/api/v1/google/callback' })
    const stored = first.sqlite.prepare('SELECT client_secret_enc FROM google_configuration').get() as { client_secret_enc: Buffer }
    expect(stored.client_secret_enc.toString()).not.toContain('client-secret')
    first.close()

    const second = openServerDatabase(path); const restarted = new GoogleConfigurationVault(second.sqlite)
    expect(restarted.status().unlocked).toBe(true)
    second.close()
  })

  it('lets a parent replace an inaccessible legacy configuration without its former passphrase', () => {
    const directory = mkdtempSync(join(tmpdir(), 'osl-google-config-')); directories.push(directory)
    const path = join(directory, 'test.db'); const first = openServerDatabase(path)
    new GoogleConfigurationVault(first.sqlite).configure({ clientId: 'old-id', clientSecret: 'old-secret', publicUrl: 'https://osl.example.test' })
    first.sqlite.prepare("INSERT INTO google_accounts (id, email, refresh_token_enc, scopes, connected_at) VALUES ('old-account', 'old@example.test', ?, 'calendar.readonly', ?)").run(Buffer.from('unusable-token'), new Date().toISOString())
    first.sqlite.prepare('UPDATE google_configuration SET client_id_enc = ? WHERE id = 1').run(Buffer.from('legacy-passphrase-ciphertext'))
    first.close()

    const second = openServerDatabase(path); const locked = new GoogleConfigurationVault(second.sqlite)
    expect(locked.status()).toMatchObject({ configured: true, unlocked: false })
    expect(locked.configure({ clientId: 'new-id', clientSecret: 'new-secret', publicUrl: 'https://osl.example.test' }).unlocked).toBe(true)
    expect(second.sqlite.prepare('SELECT count(*) AS count FROM google_accounts').get()).toEqual({ count: 0 })
    second.close()
  })

  it('accepts Google loopback HTTP redirects but rejects non-loopback HTTP', () => {
    const localDirectory = mkdtempSync(join(tmpdir(), 'osl-google-config-')); directories.push(localDirectory)
    const local = openServerDatabase(join(localDirectory, 'test.db'))
    expect(new GoogleConfigurationVault(local.sqlite).configure({ clientId: 'id', clientSecret: 'secret', publicUrl: 'http://localhost:3000' }).redirectUri)
      .toBe('http://localhost:3000/api/v1/google/callback')
    local.close()

    const lanDirectory = mkdtempSync(join(tmpdir(), 'osl-google-config-')); directories.push(lanDirectory)
    const lan = openServerDatabase(join(lanDirectory, 'test.db'))
    expect(() => new GoogleConfigurationVault(lan.sqlite).configure({ clientId: 'id', clientSecret: 'secret', publicUrl: 'http://192.168.1.20:3000' }))
      .toThrow('Google server URL must use HTTPS')
    lan.close()
  })
})
