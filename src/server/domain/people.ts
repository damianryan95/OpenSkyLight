import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { DEFAULT_PERSON_PERSONALIZATION, isBuiltInPersonThemeId, type BuiltInPersonThemeId, type PersonPersonalization } from '../../shared/personalization'
import { DuplicatePersonNameError, DomainValidationError } from './errors'

export type HouseholdRole = 'parent' | 'child'

export interface Person extends PersonPersonalization {
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
  themeId?: BuiltInPersonThemeId | null
  celebrationAssetId?: string | null
  celebrationAssetIds?: string[]
  celebrationEnabled?: boolean
  celebrationDurationMs?: number
}

export interface UpdatePersonInput {
  id: string
  name?: string
  color?: string
  role?: HouseholdRole
  sortOrder?: number
  avatarData?: string | null
  themeId?: BuiltInPersonThemeId | null
  celebrationAssetId?: string | null
  celebrationAssetIds?: string[]
  celebrationEnabled?: boolean
  celebrationDurationMs?: number
}

interface PersonRow {
  id: string
  name: string
  color: string
  role: HouseholdRole
  sort_order: number
  avatar_path: string | null
  theme_id: string | null
  celebration_asset_id: string | null
  celebration_asset_ids: string
  celebration_enabled: number
  celebration_duration_ms: number
}

/** Normalization shared with audience matching, without transport dependencies. */
export function normalizePersonName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

function displayName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id, name: row.name, color: row.color, role: row.role, sortOrder: row.sort_order, avatarUrl: row.avatar_path,
    themeId: isBuiltInPersonThemeId(row.theme_id) ? row.theme_id : null,
    celebrationAssetId: row.celebration_asset_id,
    celebrationAssetIds: parseAssetIds(row.celebration_asset_ids, row.celebration_asset_id),
    celebrationEnabled: row.celebration_enabled === 1,
    celebrationDurationMs: row.celebration_duration_ms
  }
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
    SELECT p.id, p.name, p.color, p.role, p.sort_order, p.avatar_path, p.theme_id,
      CASE WHEN asset.id IS NULL OR asset.kind != 'celebration' OR asset.deleted_at IS NOT NULL THEN NULL ELSE p.celebration_asset_id END AS celebration_asset_id,
      p.celebration_asset_ids, p.celebration_enabled, p.celebration_duration_ms
    FROM people p LEFT JOIN media_assets asset ON asset.id = p.celebration_asset_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.sort_order ASC, p.created_at ASC
  `)
  const byIdStatement = sqlite.prepare<[string], PersonRow>(`
    SELECT p.id, p.name, p.color, p.role, p.sort_order, p.avatar_path, p.theme_id,
      CASE WHEN asset.id IS NULL OR asset.kind != 'celebration' OR asset.deleted_at IS NOT NULL THEN NULL ELSE p.celebration_asset_id END AS celebration_asset_id,
      p.celebration_asset_ids, p.celebration_enabled, p.celebration_duration_ms
    FROM people p LEFT JOIN media_assets asset ON asset.id = p.celebration_asset_id
    WHERE p.id = ? AND p.deleted_at IS NULL
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
    const personalization = validatePersonalization({
      themeId: input.themeId ?? DEFAULT_PERSON_PERSONALIZATION.themeId,
      celebrationAssetId: input.celebrationAssetId ?? DEFAULT_PERSON_PERSONALIZATION.celebrationAssetId,
      celebrationAssetIds: input.celebrationAssetIds ?? (input.celebrationAssetId === undefined ? DEFAULT_PERSON_PERSONALIZATION.celebrationAssetIds : input.celebrationAssetId === null ? [] : [input.celebrationAssetId]),
      celebrationEnabled: input.celebrationEnabled ?? DEFAULT_PERSON_PERSONALIZATION.celebrationEnabled,
      celebrationDurationMs: input.celebrationDurationMs ?? DEFAULT_PERSON_PERSONALIZATION.celebrationDurationMs
    })
    assertActiveCelebrationAssets(personalization.celebrationAssetIds)
    const sortOrder = (sqlite.prepare<[], { value: number | null }>(
      'SELECT MAX(sort_order) AS value FROM people WHERE deleted_at IS NULL'
    ).get()?.value ?? -1) + 1
    try {
      sqlite.prepare(`
        INSERT INTO people (id, name, normalized_name, color, role, avatar_path, sort_order, theme_id, celebration_asset_id, celebration_asset_ids, celebration_enabled, celebration_duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, normalizedName, color, input.role, validateAvatar(input.avatarData ?? null), sortOrder, personalization.themeId, personalization.celebrationAssetIds[0] ?? null, JSON.stringify(personalization.celebrationAssetIds), Number(personalization.celebrationEnabled), personalization.celebrationDurationMs, now)
    } catch (error) {
      if (isNormalizedNameConstraint(error)) throw new DuplicatePersonNameError(name)
      throw error
    }
    return { id, name, color, role: input.role, sortOrder, avatarUrl: input.avatarData === undefined ? null : validateAvatar(input.avatarData), ...personalization }
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
    const personalization = validatePersonalization({
      themeId: input.themeId === undefined ? (isBuiltInPersonThemeId(current.theme_id) ? current.theme_id : null) : input.themeId,
      celebrationAssetId: input.celebrationAssetId === undefined ? current.celebration_asset_id : input.celebrationAssetId,
      celebrationAssetIds: input.celebrationAssetIds ?? (input.celebrationAssetId === undefined ? parseAssetIds(current.celebration_asset_ids, current.celebration_asset_id) : input.celebrationAssetId === null ? [] : [input.celebrationAssetId]),
      celebrationEnabled: input.celebrationEnabled === undefined ? current.celebration_enabled === 1 : input.celebrationEnabled,
      celebrationDurationMs: input.celebrationDurationMs === undefined ? current.celebration_duration_ms : input.celebrationDurationMs
    })
    assertActiveCelebrationAssets(personalization.celebrationAssetIds)
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new DomainValidationError('Person sort order must be a non-negative integer.')
    try {
      sqlite.prepare(`
        UPDATE people SET name = ?, normalized_name = ?, color = ?, role = ?, sort_order = ?, avatar_path = ?,
          theme_id = ?, celebration_asset_id = ?, celebration_asset_ids = ?, celebration_enabled = ?, celebration_duration_ms = ? WHERE id = ?
      `).run(name, normalizedName, color, role, sortOrder, avatarUrl, personalization.themeId, personalization.celebrationAssetIds[0] ?? null, JSON.stringify(personalization.celebrationAssetIds), Number(personalization.celebrationEnabled), personalization.celebrationDurationMs, input.id)
    } catch (error) {
      if (isNormalizedNameConstraint(error)) throw new DuplicatePersonNameError(name)
      throw error
    }
    return { id: input.id, name, color, role, sortOrder, avatarUrl, ...personalization }
  }

  function remove(id: string): void {
    const result = sqlite.prepare('UPDATE people SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), id)
    if (result.changes === 0) throw new DomainValidationError('Person not found.')
  }

  function assertActiveCelebrationAssets(assetIds: string[]): void {
    for (const assetId of assetIds) {
      const asset = sqlite.prepare('SELECT id FROM media_assets WHERE id = ? AND kind = ? AND deleted_at IS NULL').get(assetId, 'celebration')
      if (asset === undefined) throw new DomainValidationError('Celebration asset not found.')
    }
  }

  return { list, create, update, remove }
}

function validatePersonalization(value: PersonPersonalization): PersonPersonalization {
  if (value.themeId !== null && !isBuiltInPersonThemeId(value.themeId)) throw new DomainValidationError('Person theme must be a known theme or null.')
  if (!Array.isArray(value.celebrationAssetIds) || value.celebrationAssetIds.length > 20 || new Set(value.celebrationAssetIds).size !== value.celebrationAssetIds.length || value.celebrationAssetIds.some((id) => !id.trim() || id.length > 120)) throw new DomainValidationError('Celebration asset selections are invalid.')
  if (typeof value.celebrationEnabled !== 'boolean') throw new DomainValidationError('Celebration enabled must be true or false.')
  if (!Number.isInteger(value.celebrationDurationMs) || value.celebrationDurationMs < 1_500 || value.celebrationDurationMs > 5_000) throw new DomainValidationError('Celebration duration must be between 1500 and 5000 milliseconds.')
  return value
}

function parseAssetIds(value: string | null | undefined, fallback: string | null): string[] { try { const parsed: unknown = JSON.parse(value ?? '[]'); return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : fallback === null ? [] : [fallback] } catch { return fallback === null ? [] : [fallback] } }

function validateAvatar(value: string | null): string | null {
  if (value === null) return null
  if (value.length > 1_500_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(value)) throw new DomainValidationError('Avatar must be a PNG, JPEG, or WebP image smaller than 1 MB.')
  return value
}

function isNormalizedNameConstraint(error: unknown): boolean {
  return error instanceof Error && /people\.normalized_name|idx_people_active_child_normalized_name/iu.test(error.message)
}

export type PeopleService = ReturnType<typeof createPeopleService>
