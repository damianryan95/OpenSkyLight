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
