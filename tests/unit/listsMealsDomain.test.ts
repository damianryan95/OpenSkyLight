import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openServerDatabase, type ServerDatabase } from '../../src/server/db'
import { createListsDomain } from '../../src/server/domain/lists'
import { createMealsDomain } from '../../src/server/domain/meals'

const directories: string[] = []
const databases: ServerDatabase[] = []

function createDatabase(): ServerDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'openskylight-lists-meals-'))
  directories.push(directory)
  const database = openServerDatabase(join(directory, 'openskylight.db'))
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('lists domain', () => {
  it('keeps display queries separate from parent commands and soft-deletes lists', () => {
    const { sqlite } = createDatabase()
    const domain = createListsDomain(sqlite)

    expect(domain.queries).toEqual({ getAll: expect.any(Function) })
    expect(domain.parentCommands).toMatchObject({
      create: expect.any(Function),
      update: expect.any(Function),
      remove: expect.any(Function),
      addItem: expect.any(Function),
      toggleItem: expect.any(Function),
      removeItem: expect.any(Function),
      clearChecked: expect.any(Function)
    })

    const first = domain.parentCommands.create({ name: 'Groceries', color: '#00ff00', kind: 'grocery' })
    const second = domain.parentCommands.create({ name: 'Tasks', color: '#ff0000', kind: 'todo' })
    domain.parentCommands.remove(first.id)

    expect(domain.queries.getAll()).toEqual([{ ...second, items: [] }])
    expect(sqlite.prepare('SELECT deleted_at FROM lists WHERE id = ?').get(first.id)).toMatchObject({
      deleted_at: expect.any(String)
    })
    expect(() => domain.parentCommands.addItem(first.id, 'Milk')).toThrow('List not found')
  })

  it('orders lists by sort order and items unchecked-first while retaining item order', () => {
    const { sqlite } = createDatabase()
    const domain = createListsDomain(sqlite)
    const first = domain.parentCommands.create({ name: 'Zebra', color: '#111111', kind: 'custom' })
    const second = domain.parentCommands.create({ name: 'Alpha', color: '#222222', kind: 'custom' })
    const apples = domain.parentCommands.addItem(first.id, 'Apples')
    const bread = domain.parentCommands.addItem(first.id, 'Bread')
    const carrots = domain.parentCommands.addItem(first.id, 'Carrots')
    domain.parentCommands.toggleItem(bread.id)

    expect(domain.queries.getAll()).toEqual([
      {
        ...first,
        items: [
          { ...apples, checked: false, sortOrder: 1 },
          { ...carrots, checked: false, sortOrder: 3 },
          { ...bread, checked: true, sortOrder: 2 }
        ]
      },
      { ...second, items: [] }
    ])
  })
})

describe('meals domain', () => {
  it('provides inclusive, deterministic display queries and parent-only slot updates', () => {
    const { sqlite } = createDatabase()
    const domain = createMealsDomain(sqlite)

    expect(domain.queries).toEqual({ getRange: expect.any(Function), getTemplates: expect.any(Function) })
    expect(domain.parentCommands).toEqual({ set: expect.any(Function), setTemplate: expect.any(Function) })

    domain.parentCommands.set('2026-03-02', 'dinner', ' Pasta ')
    domain.parentCommands.set('2026-03-02', 'breakfast', 'Toast')
    domain.parentCommands.set('2026-03-03', 'lunch', 'Outside range')
    domain.parentCommands.setTemplate(7, 'dinner', ' Nuggets and chips ')

    expect(domain.queries.getRange('2026-03-01', '2026-03-02')).toEqual([
      { date: '2026-03-01', slot: 'dinner', text: 'Nuggets and chips' },
      { date: '2026-03-02', slot: 'breakfast', text: 'Toast' },
      { date: '2026-03-02', slot: 'dinner', text: 'Pasta' }
    ])
    expect(domain.queries.getTemplates()).toEqual([
      { dayOfWeek: 7, slot: 'dinner', text: 'Nuggets and chips' }
    ])

    domain.parentCommands.set('2026-03-01', 'dinner', 'Sunday roast')
    expect(domain.queries.getRange('2026-03-01', '2026-03-01')).toEqual([
      { date: '2026-03-01', slot: 'dinner', text: 'Sunday roast' }
    ])

    domain.parentCommands.set('2026-03-02', 'dinner', '   ')
    expect(domain.queries.getRange('2026-03-02', '2026-03-02')).toEqual([
      { date: '2026-03-02', slot: 'breakfast', text: 'Toast' }
    ])

    domain.parentCommands.setTemplate(7, 'dinner', ' ')
    expect(domain.queries.getTemplates()).toEqual([])
  })
})
