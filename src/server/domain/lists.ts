import type Database from 'better-sqlite3'
import { uuidv7 } from '../../shared/uuid'
import type { ListDto, ListItemDto, ListKind } from '../../shared/types'

export interface CreateListInput {
  name: string
  color: string
  kind: ListKind
}

export interface UpdateListInput {
  id: string
  name?: string
  color?: string
}

interface ListRow {
  id: string
  name: string
  color: string
  kind: ListKind
}

interface ListItemRow {
  id: string
  list_id: string
  text: string
  checked: number
  sort_order: number
}

function notFound(what: string): Error {
  return new Error(`${what} not found`)
}

/**
 * Electron-independent list domain services. Queries are display-safe; all
 * mutations live under parentCommands so an API capability layer can expose
 * them only to authenticated parents.
 */
export function createListsDomain(sqlite: Database.Database) {
  function getAll(): ListDto[] {
    const listRows = sqlite
      .prepare('SELECT id, name, color, kind FROM lists WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC')
      .all() as ListRow[]
    if (listRows.length === 0) return []

    const itemRows = sqlite
      .prepare(
        `SELECT id, list_id, text, checked, sort_order
         FROM list_items
         ORDER BY list_id ASC, checked ASC, sort_order ASC, created_at ASC`
      )
      .all() as ListItemRow[]
    const itemsByList = new Map<string, ListItemDto[]>()
    for (const row of itemRows) {
      const items = itemsByList.get(row.list_id) ?? []
      items.push({ id: row.id, text: row.text, checked: row.checked === 1, sortOrder: row.sort_order })
      itemsByList.set(row.list_id, items)
    }

    return listRows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      kind: row.kind,
      items: itemsByList.get(row.id) ?? []
    }))
  }

  function getById(id: string): ListDto | undefined {
    return getAll().find((list) => list.id === id)
  }

  function create(input: CreateListInput): ListDto {
    const id = uuidv7()
    sqlite
      .prepare(
        `INSERT INTO lists (id, name, color, kind, sort_order, created_at)
         VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM lists), 1), ?)`
      )
      .run(id, input.name, input.color, input.kind, new Date().toISOString())
    return { id, name: input.name, color: input.color, kind: input.kind, items: [] }
  }

  function update(input: UpdateListInput): ListDto {
    if (input.name === undefined && input.color === undefined) {
      const existing = getById(input.id)
      if (!existing) throw notFound('List')
      return existing
    }

    const result = sqlite
      .prepare(
        `UPDATE lists SET name = COALESCE(?, name), color = COALESCE(?, color)
         WHERE id = ? AND deleted_at IS NULL`
      )
      .run(input.name ?? null, input.color ?? null, input.id)
    if (result.changes === 0) throw notFound('List')
    return getById(input.id)!
  }

  /** Soft-deleted lists are excluded from every query while preserving audit data. */
  function remove(id: string): void {
    const result = sqlite
      .prepare('UPDATE lists SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(new Date().toISOString(), id)
    if (result.changes === 0) throw notFound('List')
  }

  function addItem(listId: string, text: string): ListItemDto {
    const list = sqlite.prepare('SELECT 1 FROM lists WHERE id = ? AND deleted_at IS NULL').get(listId)
    if (!list) throw notFound('List')

    const id = uuidv7()
    const sortOrder = sqlite
      .prepare('SELECT COALESCE(MAX(sort_order) + 1, 1) AS sort_order FROM list_items WHERE list_id = ?')
      .get(listId) as { sort_order: number }
    sqlite
      .prepare('INSERT INTO list_items (id, list_id, text, checked, sort_order, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(id, listId, text, sortOrder.sort_order, new Date().toISOString())
    return { id, text, checked: false, sortOrder: sortOrder.sort_order }
  }

  function toggleItem(id: string): void {
    const item = sqlite.prepare('SELECT checked FROM list_items WHERE id = ?').get(id) as { checked: number } | undefined
    if (!item) throw notFound('Item')
    const checked = item.checked === 0
    sqlite
      .prepare('UPDATE list_items SET checked = ?, checked_at = ? WHERE id = ?')
      .run(checked ? 1 : 0, checked ? new Date().toISOString() : null, id)
  }

  function removeItem(id: string): void {
    const result = sqlite.prepare('DELETE FROM list_items WHERE id = ?').run(id)
    if (result.changes === 0) throw notFound('Item')
  }

  function clearChecked(listId: string): void {
    sqlite.prepare('DELETE FROM list_items WHERE list_id = ? AND checked = 1').run(listId)
  }

  return {
    queries: { getAll },
    parentCommands: { create, update, remove, addItem, toggleItem, removeItem, clearChecked }
  }
}

export type ListsDomain = ReturnType<typeof createListsDomain>
