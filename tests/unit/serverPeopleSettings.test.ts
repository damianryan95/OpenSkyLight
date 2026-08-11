import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase } from '../../src/server/db'
import {
  createHouseholdSettingsService,
  createPeopleService,
  DomainValidationError,
  DuplicatePersonNameError,
  HouseholdTimezoneRequiredError
} from '../../src/server/domain'

const temporaryDirectories: string[] = []

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-server-people-'))
  temporaryDirectories.push(directory)
  return openServerDatabase(join(directory, 'openskylight.db'))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('server people service', () => {
  it('keeps every household member available for a personal view and orders members', () => {
    const database = createDatabase()
    const people = createPeopleService(database.sqlite)
    const parent = people.create({ name: 'Avery', color: '#ffffff', role: 'parent' })
    const child = people.create({ name: 'Léo', color: '#000000', role: 'child' })
    expect(people.list()).toEqual([parent, child])
    expect(people.update({ id: parent.id, sortOrder: 2 })).toMatchObject({ id: parent.id, role: 'parent', sortOrder: 2 })
    expect(people.list().map((person) => person.id)).toEqual([child.id, parent.id])
    database.close()
  })

  it('rejects names ambiguous to child audience inference after Unicode normalization', () => {
    const database = createDatabase()
    const people = createPeopleService(database.sqlite)
    people.create({ name: 'Ava', color: '#ffffff', role: 'child' })
    expect(() => people.create({ name: '  Ａｖａ ', color: '#ffffff', role: 'child' })).toThrow(DuplicatePersonNameError)
    expect(() => people.create({ name: '   ', color: '#ffffff', role: 'child' })).toThrow(DomainValidationError)
    const parent = people.create({ name: 'Ava', color: '#000000', role: 'parent' })
    expect(parent.role).toBe('parent')
    expect(() => people.update({ id: parent.id, role: 'child' })).toThrow(DuplicatePersonNameError)
    database.close()
  })

  it('persists validated personal themes and celebration defaults without exposing filesystem data', () => {
    const database = createDatabase()
    const people = createPeopleService(database.sqlite)
    const ava = people.create({ name: 'Ava', color: '#ffffff', role: 'child', themeId: 'minecraft', celebrationDurationMs: 4_000, celebrationEnabled: false })
    expect(ava).toMatchObject({ themeId: 'minecraft', celebrationAssetId: null, celebrationEnabled: false, celebrationDurationMs: 4_000 })
    expect(people.update({ id: ava.id, themeId: null, celebrationEnabled: true })).toMatchObject({ themeId: null, celebrationEnabled: true, celebrationDurationMs: 4_000 })
    expect(() => people.update({ id: ava.id, celebrationDurationMs: 1_499 })).toThrow('Celebration duration must be between 1500 and 5000 milliseconds.')
    expect(() => people.update({ id: ava.id, themeId: 'not-a-theme' as never })).toThrow('Person theme must be a known theme or null.')
    expect(() => people.update({ id: ava.id, celebrationAssetId: 'missing' })).toThrow('Celebration asset not found.')
    database.close()
  })

  it('falls back to neutral personalization for invalid themes or deleted assets', () => {
    const database = createDatabase()
    const now = '2026-08-08T00:00:00.000Z'
    database.sqlite.prepare("INSERT INTO media_assets (id, kind, original_name, media_type, byte_size, width, height, frame_count, sha256, storage_key, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run('deleted-asset', 'celebration', 'old.gif', 'image/gif', 20, 20, 20, 1, 'b'.repeat(64), 'asset/old', now, now)
    database.sqlite.prepare("INSERT INTO people (id, name, normalized_name, color, role, sort_order, theme_id, celebration_asset_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run('legacy', 'Legacy', 'legacy', '#ffffff', 'child', 0, 'not-a-theme', 'deleted-asset', now)
    expect(createPeopleService(database.sqlite).list()).toContainEqual(expect.objectContaining({ id: 'legacy', themeId: null, celebrationAssetId: null, celebrationEnabled: true, celebrationDurationMs: 3000 }))
    database.close()
  })
})

describe('household settings service', () => {
  it('requires a valid household timezone and never reads device settings', () => {
    const database = createDatabase()
    const settings = createHouseholdSettingsService(database.sqlite)
    expect(() => settings.get()).toThrow(HouseholdTimezoneRequiredError)
    expect(() => settings.setTimezone('Not/A_Timezone')).toThrow(DomainValidationError)
    expect(settings.setTimezone('Australia/Perth')).toEqual({ timezone: 'Australia/Perth', weather: null })
    expect(settings.get()).toEqual({ timezone: 'Australia/Perth', weather: null })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM devices').get()).toMatchObject({ count: 0 })
    database.close()
  })
})
