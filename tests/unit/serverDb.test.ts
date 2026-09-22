import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase } from '../../src/server/db'
import { latestSchemaVersion } from '../../src/server/db/migrations'

const temporaryDirectories: string[] = []

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-server-db-'))
  temporaryDirectories.push(directory)
  return join(directory, 'openskylight.db')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('server SQLite database', () => {
  it('migrates an empty database, configures SQLite, and is idempotent', () => {
    const path = createDatabasePath()
    const first = openServerDatabase(path)

    expect(first.sqlite.pragma('user_version', { simple: true })).toBe(latestSchemaVersion)
    expect(first.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(first.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(first.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(first.sqlite.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get()).toMatchObject({ count: 22 })
    first.close()

    const second = openServerDatabase(path)
    expect(second.sqlite.pragma('user_version', { simple: true })).toBe(latestSchemaVersion)
    second.close()
  })

  it('enforces calendar audience references and core unique constraints', () => {
    const database = openServerDatabase(createDatabasePath())
    const { sqlite } = database
    const now = '2026-01-01T00:00:00.000Z'
    sqlite.prepare("INSERT INTO calendar_sources (id, kind, name, connected_at) VALUES (?, ?, ?, ?)").run('source', 'caldav', 'Household', now)

    expect(() => sqlite.prepare("INSERT INTO calendars (id, source_id, source_calendar_id, audience_person_id, name) VALUES (?, ?, ?, ?, ?)").run('calendar-1', 'source', 'primary', 'missing-person', 'Family')).toThrow(/FOREIGN KEY constraint failed/)

    sqlite.prepare("INSERT INTO people (id, name, color, role, created_at) VALUES (?, ?, ?, ?, ?)").run('child', 'Alice', '#ffffff', 'child', now)
    sqlite.prepare("INSERT INTO calendars (id, source_id, source_calendar_id, audience_person_id, name) VALUES (?, ?, ?, ?, ?)").run('calendar-1', 'source', 'primary', 'child', 'Alice')

    expect(() => sqlite.prepare("INSERT INTO calendars (id, source_id, source_calendar_id, name) VALUES (?, ?, ?, ?)").run('calendar-2', 'source', 'primary', 'Duplicate')).toThrow(/UNIQUE constraint failed/)
    expect(() => sqlite.prepare("INSERT INTO meal_slots (id, date, slot) VALUES (?, ?, ?)").run('meal-1', '2026-01-01', 'dinner')).not.toThrow()
    expect(() => sqlite.prepare("INSERT INTO meal_slots (id, date, slot) VALUES (?, ?, ?)").run('meal-2', '2026-01-01', 'dinner')).toThrow(/UNIQUE constraint failed/)
    database.close()
  })

  it('provides safe defaults and references for person personalization', () => {
    const database = openServerDatabase(createDatabasePath())
    const { sqlite } = database
    const now = '2026-01-01T00:00:00.000Z'
    sqlite.prepare("INSERT INTO people (id, name, color, role, created_at) VALUES (?, ?, ?, ?, ?)").run('child', 'Alice', '#ffffff', 'child', now)
    expect(sqlite.prepare('SELECT theme_id, celebration_asset_id, celebration_enabled, celebration_duration_ms FROM people WHERE id = ?').get('child')).toEqual({ theme_id: null, celebration_asset_id: null, celebration_enabled: 1, celebration_duration_ms: 3000 })
    expect(() => sqlite.prepare("UPDATE people SET celebration_asset_id = 'missing' WHERE id = 'child'").run()).toThrow(/FOREIGN KEY constraint failed/)
    sqlite.prepare("INSERT INTO media_assets (id, kind, original_name, media_type, byte_size, width, height, frame_count, sha256, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run('asset', 'celebration', 'victory.webp', 'image/webp', 20, 20, 20, 1, 'a'.repeat(64), 'asset/1', now)
    expect(() => sqlite.prepare("UPDATE people SET celebration_asset_id = 'asset' WHERE id = 'child'").run()).not.toThrow()
    database.close()
  })
})
