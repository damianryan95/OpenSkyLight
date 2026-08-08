import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { DuplicatePersonNameError, DomainValidationError } from './errors'

export type HouseholdRole = 'parent' | 'child'

export interface Person {
  id: string
  name: string
  color: string
  role: HouseholdRole
  sortOrder: number
  avatarUrl: string | null
}

export interface CreatePersonInput {
  name: string
  color: string
  role: HouseholdRole
  avatarData?: string | null
}

export interface UpdatePersonInput {
  id: string
  name?: string
  color?: string
  role?: HouseholdRole
  sortOrder?: number
  avatarData?: string | null
}

interface PersonRow {
  id: string
  name: string
  color: string
  role: HouseholdRole
  sort_order: number
  avatar_path: string | null
}

/** Normalization shared with audience matching, without transport dependencies. */
export function normalizePersonName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

function displayName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function toPerson(row: PersonRow): Person {
  return { id: row.id, name: row.name, color: row.color, role: row.role, sortOrder: row.sort_order, avatarUrl: row.avatar_path }
}

function validateRole(role: string): asserts role is HouseholdRole {
  if (role !== 'parent' && role !== 'child') throw new DomainValidationError('Person role must be parent or child.')
}

function validateName(name: string): string {
  const normalized = normalizePersonName(name)
  if (!normalized) throw new DomainValidationError('Person name is required.')
  return normalized
}

function validateColor(color: string): string {
  const result = color.trim()
  if (!result) throw new DomainValidationError('Person color is required.')
  return result
}

/** Server-owned household people, with roles only affecting text audience inference. */
export function createPeopleService(sqlite: Database.Database) {
  const listStatement = sqlite.prepare<[], PersonRow>(`
    SELECT id, name, color, role, sort_order, avatar_path
    FROM people WHERE deleted_at IS NULL
    ORDER BY sort_order ASC, created_at ASC
  `)
  const byIdStatement = sqlite.prepare<[string], PersonRow>(`
    SELECT id, name, color, role, sort_order, avatar_path FROM people WHERE id = ? AND deleted_at IS NULL
  `)

  function list(): Person[] {
    return listStatement.all().map(toPerson)
  }

  function create(input: CreatePersonInput): Person {
    validateRole(input.role)
    const normalizedName = validateName(input.name)
    const name = displayName(input.name)
    const color = validateColor(input.color)
    const now = new Date().toISOString()
    const id = randomUUID()
    const sortOrder = (sqlite.prepare<[], { value: number | null }>(
      'SELECT MAX(sort_order) AS value FROM people WHERE deleted_at IS NULL'
    ).get()?.value ?? -1) + 1
    try {
      sqlite.prepare(`
        INSERT INTO people (id, name, normalized_name, color, role, avatar_path, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, normalizedName, color, input.role, validateAvatar(input.avatarData ?? null), sortOrder, now)
    } catch (error) {
      if (isNormalizedNameConstraint(error)) throw new DuplicatePersonNameError(name)
      throw error
    }
    return { id, name, color, role: input.role, sortOrder, avatarUrl: input.avatarData === undefined ? null : validateAvatar(input.avatarData) }
  }

  function update(input: UpdatePersonInput): Person {
    const current = byIdStatement.get(input.id)
    if (!current) throw new DomainValidationError('Person not found.')
    const role = input.role ?? current.role
    validateRole(role)
    const name = input.name === undefined ? current.name : displayName(input.name)
    const normalizedName = validateName(name)
    const color = input.color === undefined ? current.color : validateColor(input.color)
    const sortOrder = input.sortOrder ?? current.sort_order
    const avatarUrl = input.avatarData === undefined ? current.avatar_path : validateAvatar(input.avatarData)
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new DomainValidationError('Person sort order must be a non-negative integer.')
    try {
      sqlite.prepare(`
        UPDATE people SET name = ?, normalized_name = ?, color = ?, role = ?, sort_order = ?, avatar_path = ? WHERE id = ?
      `).run(name, normalizedName, color, role, sortOrder, avatarUrl, input.id)
    } catch (error) {
      if (isNormalizedNameConstraint(error)) throw new DuplicatePersonNameError(name)
      throw error
    }
    return { id: input.id, name, color, role, sortOrder, avatarUrl }
  }

  function remove(id: string): void {
    const result = sqlite.prepare('UPDATE people SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), id)
    if (result.changes === 0) throw new DomainValidationError('Person not found.')
  }

  return { list, create, update, remove }
}

function validateAvatar(value: string | null): string | null {
  if (value === null) return null
  if (value.length > 1_500_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(value)) throw new DomainValidationError('Avatar must be a PNG, JPEG, or WebP image smaller than 1 MB.')
  return value
}

function isNormalizedNameConstraint(error: unknown): boolean {
  return error instanceof Error && /people\.normalized_name|idx_people_active_child_normalized_name/iu.test(error.message)
}

export type PeopleService = ReturnType<typeof createPeopleService>
