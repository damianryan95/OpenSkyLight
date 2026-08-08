import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'

const PIN_HASH_KEY_LENGTH = 64
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000
const BACKOFF_START_AFTER_FAILURES = 3
const MAX_BACKOFF_MS = 15 * 60 * 1000

export const PARENT_SESSION_COOKIE = 'osl_parent_session'
export const CSRF_HEADER = 'x-osl-csrf-token'

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 409 | 429,
    public readonly code: 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited',
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface ParentSession {
  csrfToken: string
  expiresAt: string
}

export interface DisplayDevice {
  id: string
  name: string
  homeLayout: unknown | null
  themePreference: unknown | null
  sleepSettings: unknown | null
  kioskPreferences: unknown | null
  registeredAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export interface RegisteredDisplay extends DisplayDevice {
  /** Returned exactly once to the parent-approved registration caller. */
  credential: string
}

export interface AuthClock {
  now(): Date
}

const systemClock: AuthClock = { now: () => new Date() }

/**
 * The only implementation which reads a household PIN. PINs are immediately
 * transformed by scrypt and must never cross a logging boundary.
 */
export class HouseholdAuthService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: AuthClock = systemClock
  ) {}

  isConfigured(): boolean {
    return this.sqlite.prepare('SELECT 1 FROM household_auth WHERE id = 1').get() !== undefined
  }

  setup(pin: string): ParentSession & { sessionToken: string } {
    assertPin(pin)
    const now = this.now()
    const create = this.sqlite.transaction(() => {
      if (this.isConfigured()) throw new AuthError(409, 'conflict', 'Household PIN has already been configured')
      this.sqlite.prepare('INSERT INTO household_auth (id, pin_hash, created_at, updated_at) VALUES (1, ?, ?, ?)')
        .run(hashPin(pin), now, now)
      this.resetFailures(now)
      return this.createSession(now)
    })
    return create()
  }

  login(pin: string): ParentSession & { sessionToken: string } {
    assertPin(pin)
    const now = this.now()
    const state = this.sqlite.prepare('SELECT failed_attempts, backoff_until FROM auth_attempt_state WHERE id = 1').get() as
      | { failed_attempts: number; backoff_until: string | null }
      | undefined
    if (state?.backoff_until !== null && state?.backoff_until !== undefined && Date.parse(state.backoff_until) > this.clock.now().getTime()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(state.backoff_until) - this.clock.now().getTime()) / 1000))
      throw new AuthError(429, 'rate_limited', 'PIN attempts are temporarily throttled', retryAfterSeconds)
    }

    const record = this.sqlite.prepare('SELECT pin_hash FROM household_auth WHERE id = 1').get() as { pin_hash: string } | undefined
    if (record === undefined) throw new AuthError(409, 'conflict', 'Household PIN has not been configured')
    if (!verifyPin(pin, record.pin_hash)) {
      this.recordFailure(now, state?.failed_attempts ?? 0)
      throw new AuthError(401, 'unauthorized', 'Invalid household PIN')
    }

    return this.sqlite.transaction(() => {
      this.resetFailures(now)
      return this.createSession(now)
    })()
  }

  getParentSession(sessionToken: string | undefined): ParentSession | undefined {
    if (sessionToken === undefined) return undefined
    const now = this.now()
    const row = this.sqlite.prepare(
      "SELECT expires_at FROM auth_sessions WHERE kind = 'parent' AND secret_hash = ? AND revoked_at IS NULL AND expires_at > ?"
    ).get(hashSecret(sessionToken), now) as { expires_at: string } | undefined
    return row === undefined ? undefined : { csrfToken: '', expiresAt: row.expires_at }
  }

  requireParentMutation(sessionToken: string | undefined, csrfToken: string | undefined): void {
    if (sessionToken === undefined) throw new AuthError(401, 'unauthorized', 'Parent session is required')
    if (csrfToken === undefined) throw new AuthError(403, 'forbidden', 'CSRF token is required')
    const now = this.now()
    const row = this.sqlite.prepare(
      "SELECT csrf_secret_hash FROM auth_sessions WHERE kind = 'parent' AND secret_hash = ? AND revoked_at IS NULL AND expires_at > ?"
    ).get(hashSecret(sessionToken), now) as { csrf_secret_hash: Buffer | null } | undefined
    if (row === undefined) throw new AuthError(401, 'unauthorized', 'Parent session is invalid or expired')
    if (row.csrf_secret_hash === null || !safeEqual(hashSecret(csrfToken), row.csrf_secret_hash)) {
      throw new AuthError(403, 'forbidden', 'CSRF token is invalid')
    }
  }

  logout(sessionToken: string | undefined): void {
    if (sessionToken === undefined) return
    this.sqlite.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE kind = 'parent' AND secret_hash = ? AND revoked_at IS NULL")
      .run(this.now(), hashSecret(sessionToken))
  }

  changePin(sessionToken: string | undefined, csrfToken: string | undefined, newPin: string): void {
    assertPin(newPin)
    this.requireParentMutation(sessionToken, csrfToken)
    const now = this.now()
    this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE household_auth SET pin_hash = ?, updated_at = ? WHERE id = 1').run(hashPin(newPin), now)
      this.sqlite.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE kind = 'parent' AND revoked_at IS NULL").run(now)
      this.resetFailures(now)
    })()
  }

  private createSession(now: string): ParentSession & { sessionToken: string } {
    const sessionToken = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(this.clock.now().getTime() + SESSION_LIFETIME_MS).toISOString()
    this.sqlite.prepare(
      "INSERT INTO auth_sessions (id, kind, secret_hash, csrf_secret_hash, expires_at, created_at) VALUES (?, 'parent', ?, ?, ?, ?)"
    ).run(randomBytes(16).toString('hex'), hashSecret(sessionToken), hashSecret(csrfToken), expiresAt, now)
    return { sessionToken, csrfToken, expiresAt }
  }

  private recordFailure(now: string, previousFailures: number): void {
    const failedAttempts = previousFailures + 1
    const overThreshold = Math.max(0, failedAttempts - BACKOFF_START_AFTER_FAILURES)
    const backoffMs = overThreshold === 0 ? 0 : Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (overThreshold - 1))
    const backoffUntil = backoffMs === 0 ? null : new Date(this.clock.now().getTime() + backoffMs).toISOString()
    this.sqlite.prepare(
      `INSERT INTO auth_attempt_state (id, failed_attempts, backoff_until, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET failed_attempts = excluded.failed_attempts, backoff_until = excluded.backoff_until, updated_at = excluded.updated_at`
    ).run(failedAttempts, backoffUntil, now)
  }

  private resetFailures(now: string): void {
    this.sqlite.prepare(
      `INSERT INTO auth_attempt_state (id, failed_attempts, backoff_until, updated_at) VALUES (1, 0, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET failed_attempts = 0, backoff_until = NULL, updated_at = excluded.updated_at`
    ).run(now)
  }

  private now(): string {
    return this.clock.now().toISOString()
  }
}

/**
 * Central registry for kiosk devices.  The device credential is a high-entropy
 * bearer secret; only its SHA-256 digest is persisted and ordinary display DTOs
 * deliberately omit it.
 */
export class DisplayDeviceService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: AuthClock = systemClock
  ) {}

  register(input: { name: string, homeLayout?: unknown, themePreference?: unknown, sleepSettings?: unknown, kioskPreferences?: unknown }): RegisteredDisplay {
    const name = assertDeviceName(input.name)
    const now = this.now()
    const id = randomBytes(16).toString('hex')
    const credential = randomBytes(32).toString('base64url')
    try {
      this.sqlite.prepare(
        `INSERT INTO devices (id, name, credential_hash, home_layout, theme_preference, sleep_settings, kiosk_preferences, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, name, hashSecret(credential), jsonOrNull(input.homeLayout), jsonOrNull(input.themePreference), jsonOrNull(input.sleepSettings), jsonOrNull(input.kioskPreferences), now)
    } catch (error) {
      if (isUniqueConstraint(error)) throw new AuthError(409, 'conflict', 'A display with that name already exists')
      throw error
    }
    return { ...this.getById(id)!, credential }
  }

  list(): DisplayDevice[] {
    return this.sqlite.prepare(
      'SELECT id, name, home_layout, theme_preference, sleep_settings, kiosk_preferences, registered_at, last_seen_at, revoked_at FROM devices ORDER BY registered_at, id'
    ).all().map(rowToDisplay)
  }

  update(id: string, input: { name?: string, homeLayout?: unknown, themePreference?: unknown, sleepSettings?: unknown, kioskPreferences?: unknown }): DisplayDevice {
    const existing = this.getById(id)
    if (existing === undefined) throw new AuthError(401, 'unauthorized', 'Display was not found')
    const name = input.name === undefined ? existing.name : assertDeviceName(input.name)
    try {
      this.sqlite.prepare(
        `UPDATE devices SET name = ?, home_layout = ?, theme_preference = ?, sleep_settings = ?, kiosk_preferences = ? WHERE id = ?`
      ).run(name, input.homeLayout === undefined ? jsonOrNull(existing.homeLayout) : jsonOrNull(input.homeLayout), input.themePreference === undefined ? jsonOrNull(existing.themePreference) : jsonOrNull(input.themePreference), input.sleepSettings === undefined ? jsonOrNull(existing.sleepSettings) : jsonOrNull(input.sleepSettings), input.kioskPreferences === undefined ? jsonOrNull(existing.kioskPreferences) : jsonOrNull(input.kioskPreferences), id)
    } catch (error) {
      if (isUniqueConstraint(error)) throw new AuthError(409, 'conflict', 'A display with that name already exists')
      throw error
    }
    return this.getById(id)!
  }

  revoke(id: string): void {
    const result = this.sqlite.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(this.now(), id)
    if (result.changes === 0) throw new AuthError(401, 'unauthorized', 'Display was not found')
  }

  authenticate(credential: string | undefined): DisplayDevice | undefined {
    if (credential === undefined || credential.length === 0) return undefined
    const row = this.sqlite.prepare(
      `SELECT id, name, home_layout, theme_preference, sleep_settings, kiosk_preferences, registered_at, last_seen_at, revoked_at
       FROM devices WHERE credential_hash = ? AND revoked_at IS NULL`
    ).get(hashSecret(credential))
    if (row === undefined) return undefined
    const device = rowToDisplay(row)
    this.sqlite.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(this.now(), device.id)
    return { ...device, lastSeenAt: this.now() }
  }

  private getById(id: string): DisplayDevice | undefined {
    const row = this.sqlite.prepare(
      'SELECT id, name, home_layout, theme_preference, sleep_settings, kiosk_preferences, registered_at, last_seen_at, revoked_at FROM devices WHERE id = ?'
    ).get(id)
    return row === undefined ? undefined : rowToDisplay(row)
  }

  private now(): string { return this.clock.now().toISOString() }
}

function assertPin(pin: string): void {
  if (!/^\d{4,64}$/.test(pin)) throw new AuthError(401, 'unauthorized', 'PIN must contain 4 to 64 digits')
}

function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const digest = scryptSync(pin, salt, PIN_HASH_KEY_LENGTH, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`
}

function verifyPin(pin: string, encoded: string): boolean {
  const [algorithm, n, r, p, salt, digest] = encoded.split('$')
  if (algorithm !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1' || salt === undefined || digest === undefined) return false
  const expected = Buffer.from(digest, 'base64url')
  const candidate = scryptSync(pin, Buffer.from(salt, 'base64url'), expected.length, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return safeEqual(candidate, expected)
}

function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

function assertDeviceName(name: string): string {
  const normalized = name.trim()
  if (normalized.length < 1 || normalized.length > 120) throw new AuthError(401, 'unauthorized', 'Display name must contain 1 to 120 characters')
  return normalized
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

function rowToDisplay(row: unknown): DisplayDevice {
  const record = row as Record<string, unknown>
  return {
    id: String(record.id), name: String(record.name),
    homeLayout: parseJson(record.home_layout), themePreference: parseJson(record.theme_preference),
    sleepSettings: parseJson(record.sleep_settings), kioskPreferences: parseJson(record.kiosk_preferences),
    registeredAt: String(record.registered_at), lastSeenAt: record.last_seen_at === null ? null : String(record.last_seen_at),
    revokedAt: record.revoked_at === null ? null : String(record.revoked_at)
  }
}

function parseJson(value: unknown): unknown | null {
  return value === null || value === undefined ? null : JSON.parse(String(value))
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}
