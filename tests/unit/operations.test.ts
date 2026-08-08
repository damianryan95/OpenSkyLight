import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { backupDatabase, inspectDatabase, restoreDatabase } from '../../src/server/operations'
import { openServerDatabase } from '../../src/server/db'

const directories: string[] = []

function temporaryPath(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'osl-operations-'))
  directories.push(directory)
  return join(directory, name)
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('database operations', () => {
  it('backs up a consistent snapshot and restores it into a clean volume', async () => {
    const source = temporaryPath('source.db')
    const snapshot = temporaryPath('backup.db')
    const restored = temporaryPath('restored.db')
    const database = openServerDatabase(source)
    database.sqlite.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('timezone', 'Australia/Perth', '2026-08-04T00:00:00.000Z')").run()
    database.close()

    const backup = await backupDatabase(source, snapshot)
    expect(backup.schemaVersion).toBeGreaterThan(0)
    expect(existsSync(snapshot)).toBe(true)
    const restoredSnapshot = await restoreDatabase(snapshot, restored)
    expect(restoredSnapshot.schemaVersion).toBe(backup.schemaVersion)
    const restoredDatabase = openServerDatabase(restored)
    expect(restoredDatabase.sqlite.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()).toEqual({ value: 'Australia/Perth' })
    restoredDatabase.close()
  })

  it('refuses a live overwrite and leaves the pre-upgrade backup unchanged after a failed migration check', async () => {
    const source = temporaryPath('source.db')
    const snapshot = temporaryPath('backup.db')
    const target = temporaryPath('target.db')
    openServerDatabase(source).close()
    await backupDatabase(source, snapshot)
    const before = readFileSync(snapshot)
    openServerDatabase(target).close()
    await expect(restoreDatabase(snapshot, target)).rejects.toThrow(/clean volume/)
    expect(readFileSync(snapshot)).toEqual(before)

    const invalid = temporaryPath('unsupported.db')
    const raw = openServerDatabase(invalid)
    raw.sqlite.pragma('user_version = 999')
    raw.close()
    expect(() => inspectDatabase(invalid)).toThrow(/Unsupported database schema version/)
    expect(readFileSync(snapshot)).toEqual(before)
  })
})
