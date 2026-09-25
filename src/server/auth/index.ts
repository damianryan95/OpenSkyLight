import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'

const PIN_HASH_KEY_LENGTH = 64
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000
const BACKOFF_START_AFTER_FAILURES = 3
const MAX_BACKOFF_MS = 15 * 60 * 1000

/**
 * Crockford base32 — I, L, O and U are absent, so a parent reading a code off a
 * wall display cannot confuse it with 1, 0 or a rude word. The excluded letters
 * are folded back to their digits on the way in rather than rejected.
 */
const ENROLMENT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENROLMENT_CODE_LENGTH = 8
const ENROLMENT_CODE_LIFETIME_MS = 5 * 60 * 1000
/** How long an adopted display's credential waits for its screen to collect it. */
const ENROLMENT_COLLECTION_WINDOW_MS = 5 * 60 * 1000
/** Dead codes are swept long after they can matter, so the table stays bounded. */
const ENROLMENT_ROW_RETENTION_MS = 24 * 60 * 60 * 1000
const ENROLMENT_MINT_LIMIT = 30
const ENROLMENT_REDEEM_FAILURE_LIMIT = 10
const ENROLMENT_RATE_WINDOW_MS = 10 * 60 * 1000
/**
 * The single refusal for every unusable code: never minted, expired, already
 * redeemed, or malformed. A caller that could tell those apart could probe the
 * code space for live codes, so they are deliberately one answer.
 */
const ENROLMENT_REFUSAL = 'That enrolment code was not accepted. Ask the screen to show a new code.'

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

export interface ParentDevice {
  id: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export interface PairedParentDevice extends ParentDevice {
  /** Returned exactly once, to the PIN-authenticated pairing caller. */
  credential: string
}

/** Minted by a screen that has no credential yet. Only `code` may be displayed. */
export interface MintedEnrolmentCode {
  /** Short, human-readable, carried in the QR on a wall. Public by construction. */
  code: string
  /** High-entropy, returned only to the minting screen. Never displayed, never in the QR. */
  pollToken: string
  expiresAt: string
}

export type EnrolmentClaim =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'adopted', credential: string, display: DisplayDevice }

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

  /**
   * First-run setup and first pairing as one act (ADR 0006, case 1).
   *
   * The PIN is created and `pair` runs inside a single transaction, so the two
   * outcomes a phone could otherwise be left in cannot occur: a household with a
   * PIN that no device can use, or a paired device on a household that has no
   * PIN. `setup` refuses a configured household inside that same transaction,
   * which is also what settles two phones racing to claim a brand-new screen —
   * exactly one of them wins and the other is told so.
   *
   * The browser session `setup` mints is discarded here: a phone authenticates
   * with the bearer credential `pair` returns, never with a cookie.
   */
  claim<T>(pin: string, pair: () => T): T {
    return this.sqlite.transaction(() => {
      const session = this.setup(pin)
      this.logout(session.sessionToken)
      return pair()
    })()
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
 * The bearer-credential mechanics shared by the display and parent registries:
 * mint a high-entropy secret, persist only its SHA-256 digest, resolve a device
 * from a presented secret, touch it, and revoke it.
 *
 * The two registries stay separate services over separate tables on purpose
 * (see migration 010): a parent credential is far more powerful than a display
 * one, and only this narrow mechanical core is genuinely common to both. Table
 * and column names are interpolated, which is safe here and only here because
 * both call sites are string literals in this file — no caller supplies them.
 */
class CredentialRegistry {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly table: 'devices' | 'parent_devices',
    private readonly columns: string,
    private readonly issuedAtColumn: 'registered_at' | 'paired_at',
    private readonly notFoundMessage: string
  ) {}

  mint(): { id: string, credential: string, credentialHash: Buffer } {
    const credential = randomBytes(32).toString('base64url')
    return { id: randomBytes(16).toString('hex'), credential, credentialHash: hashSecret(credential) }
  }

  findById(id: string): unknown | undefined {
    return this.sqlite.prepare(`SELECT ${this.columns} FROM ${this.table} WHERE id = ?`).get(id)
  }

  all(): unknown[] {
    return this.sqlite.prepare(`SELECT ${this.columns} FROM ${this.table} ORDER BY ${this.issuedAtColumn}, id`).all()
  }

  /**
   * `revoked_at IS NULL` is filtered in SQL rather than against any cached set
   * of devices, so a revoked credential fails closed on the very next request.
   */
  findByCredential(credential: string | undefined): unknown | undefined {
    if (credential === undefined || credential.length === 0) return undefined
    const presented = hashSecret(credential)
    const row = this.sqlite.prepare(
      `SELECT ${this.columns}, credential_hash FROM ${this.table} WHERE credential_hash = ? AND revoked_at IS NULL`
    ).get(presented) as { credential_hash: Buffer } | undefined
    if (row === undefined || !safeEqual(presented, row.credential_hash)) return undefined
    return row
  }

  touch(id: string, at: string): void {
    this.sqlite.prepare(`UPDATE ${this.table} SET last_seen_at = ? WHERE id = ?`).run(at, id)
  }

  revoke(id: string, at: string): void {
    const result = this.sqlite.prepare(`UPDATE ${this.table} SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?`).run(at, id)
    if (result.changes === 0) throw new AuthError(401, 'unauthorized', this.notFoundMessage)
  }
}

const DISPLAY_COLUMNS = 'id, name, home_layout, theme_preference, sleep_settings, kiosk_preferences, registered_at, last_seen_at, revoked_at'
const PARENT_DEVICE_COLUMNS = 'id, name, paired_at, last_seen_at, revoked_at'

/**
 * Central registry for kiosk devices.  The device credential is a high-entropy
 * bearer secret; only its SHA-256 digest is persisted and ordinary display DTOs
 * deliberately omit it.
 */
export class DisplayDeviceService {
  private readonly credentials: CredentialRegistry

  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: AuthClock = systemClock
  ) {
    this.credentials = new CredentialRegistry(sqlite, 'devices', DISPLAY_COLUMNS, 'registered_at', 'Display was not found')
  }

  register(input: { name: string, homeLayout?: unknown, themePreference?: unknown, sleepSettings?: unknown, kioskPreferences?: unknown }): RegisteredDisplay {
    const name = assertDeviceName(input.name, 'Display')
    const now = this.now()
    const { id, credential, credentialHash } = this.credentials.mint()
    try {
      this.sqlite.prepare(
        `INSERT INTO devices (id, name, credential_hash, home_layout, theme_preference, sleep_settings, kiosk_preferences, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, name, credentialHash, jsonOrNull(input.homeLayout), jsonOrNull(input.themePreference), jsonOrNull(input.sleepSettings), jsonOrNull(input.kioskPreferences), now)
    } catch (error) {
      if (isUniqueConstraint(error)) throw new AuthError(409, 'conflict', 'A display with that name already exists')
      throw error
    }
    return { ...this.getById(id)!, credential }
  }

  /**
   * Registers a display that has not collected its credential yet (ADR 0006).
   *
   * The stored hash is random bytes with no preimage anyone holds, so nothing
   * can authenticate as this display until `issueCredential` replaces it. That
   * is what lets the phone's redeem and the screen's collection be two separate
   * requests with nothing secret parked between them.
   */
  registerAwaitingCredential(input: { name: string }): DisplayDevice {
    const name = assertDeviceName(input.name, 'Display')
    const now = this.now()
    const id = randomBytes(16).toString('hex')
    try {
      this.sqlite.prepare(
        'INSERT INTO devices (id, name, credential_hash, registered_at) VALUES (?, ?, ?, ?)'
      ).run(id, name, randomBytes(32), now)
    } catch (error) {
      if (isUniqueConstraint(error)) throw new AuthError(409, 'conflict', 'A display with that name already exists')
      throw error
    }
    return this.getById(id)!
  }

  /** Mints the credential for a display and returns it - the one moment it
   * exists in plaintext. Refused for a revoked or unknown display. */
  issueCredential(id: string): string {
    const { credential, credentialHash } = this.credentials.mint()
    const result = this.sqlite.prepare('UPDATE devices SET credential_hash = ? WHERE id = ? AND revoked_at IS NULL').run(credentialHash, id)
    if (result.changes !== 1) throw new AuthError(401, 'unauthorized', 'Display was not found')
    return credential
  }

  list(): DisplayDevice[] {
    return this.credentials.all().map(rowToDisplay)
  }

  /** Reads a display by id. Like every display DTO, it omits the credential. */
  find(id: string): DisplayDevice | undefined {
    return this.getById(id)
  }

  update(id: string, input: { name?: string, homeLayout?: unknown, themePreference?: unknown, sleepSettings?: unknown, kioskPreferences?: unknown }): DisplayDevice {
    const existing = this.getById(id)
    if (existing === undefined) throw new AuthError(401, 'unauthorized', 'Display was not found')
    const name = input.name === undefined ? existing.name : assertDeviceName(input.name, 'Display')
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
    this.credentials.revoke(id, this.now())
  }

  authenticate(credential: string | undefined): DisplayDevice | undefined {
    const row = this.credentials.findByCredential(credential)
    if (row === undefined) return undefined
    const device = rowToDisplay(row)
    const now = this.now()
    this.credentials.touch(device.id, now)
    return { ...device, lastSeenAt: now }
  }

  private getById(id: string): DisplayDevice | undefined {
    const row = this.credentials.findById(id)
    return row === undefined ? undefined : rowToDisplay(row)
  }

  private now(): string { return this.clock.now().toISOString() }
}

/**
 * Central registry for paired parent phones. Structurally a sibling of
 * `DisplayDeviceService`, sharing its credential mechanics but none of its
 * display-only state (home layout, theme, sleep window, kiosk preferences) —
 * a phone has no use for any of it.
 *
 * A credential here is parent-level, so it is shown exactly once by `pair`,
 * stored only as a digest, and omitted from every DTO `list` returns.
 */
export class ParentDeviceService {
  private readonly credentials: CredentialRegistry

  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: AuthClock = systemClock
  ) {
    this.credentials = new CredentialRegistry(sqlite, 'parent_devices', PARENT_DEVICE_COLUMNS, 'paired_at', 'Paired phone was not found')
  }

  /** The caller is responsible for having authorised this at parent level. */
  pair(input: { name: string }): PairedParentDevice {
    const name = assertDeviceName(input.name, 'Phone')
    const { id, credential, credentialHash } = this.credentials.mint()
    try {
      this.sqlite.prepare('INSERT INTO parent_devices (id, name, credential_hash, paired_at) VALUES (?, ?, ?, ?)')
        .run(id, name, credentialHash, this.now())
    } catch (error) {
      if (isUniqueConstraint(error)) throw new AuthError(409, 'conflict', 'A phone with that name is already paired')
      throw error
    }
    return { ...this.getById(id)!, credential }
  }

  list(): ParentDevice[] {
    return this.credentials.all().map(rowToParentDevice)
  }

  revoke(id: string): void {
    this.credentials.revoke(id, this.now())
  }

  authenticate(credential: string | undefined): ParentDevice | undefined {
    const row = this.credentials.findByCredential(credential)
    if (row === undefined) return undefined
    const device = rowToParentDevice(row)
    const now = this.now()
    this.credentials.touch(device.id, now)
    return { ...device, lastSeenAt: now }
  }

  private getById(id: string): ParentDevice | undefined {
    const row = this.credentials.findById(id)
    return row === undefined ? undefined : rowToParentDevice(row)
  }

  private now(): string { return this.clock.now().toISOString() }
}

/**
 * Screen-initiated enrolment (ADR 0006): a screen with no credential asks to be
 * adopted, shows the code it is given as a QR, and a parent's phone redeems it.
 *
 * The property the whole ceremony rests on is that **the QR is on a wall**.
 * Anyone who can see the screen can photograph the code, so the code alone must
 * never be enough to collect a display credential. Minting therefore returns
 * two secrets: the code, which is public by construction, and a `pollToken`
 * which is returned only to the minting screen, is never rendered and never
 * enters the QR. A parent's redemption registers the display; the credential is
 * released only to a caller presenting the matching poll token, exactly once.
 * A stranger who photographs the QR can at worst get a screen adopted — which
 * still takes a parent's authorisation — and never learns the credential.
 *
 * The credential between redemption and collection is held **in memory only**,
 * never written to disk in any form. A server restart mid-ceremony therefore
 * used to forfeit that adoption, because the credential waited in server memory
 * between the phone's redeem and the screen's collection - and a Portainer
 * redeploy is a restart, so the normal way changes shipped also stranded any
 * screen scanned around the same time as a registered-but-never-seen row.
 *
 * Now nothing waits anywhere. Redeem registers the display with a credential
 * hash nobody holds a preimage for; the screen's claim mints the real
 * credential in the moment it hands it over, and `collected_at` makes that
 * single-use. The enrolment row in SQLite is the whole hand-off, so a restart in
 * the gap loses nothing, and a screen that never comes back is provable - a
 * redeemed row past its collection window with no `collected_at` - and its
 * useless display row is swept.
 */
export class DisplayEnrolmentService {
  private readonly mintAttempts = new AttemptWindow(ENROLMENT_MINT_LIMIT, ENROLMENT_RATE_WINDOW_MS)
  private readonly redeemFailures = new AttemptWindow(ENROLMENT_REDEEM_FAILURE_LIMIT, ENROLMENT_RATE_WINDOW_MS)

  constructor(
    private readonly sqlite: Database.Database,
    private readonly displays: DisplayDeviceService,
    private readonly clock: AuthClock = systemClock
  ) {}

  /**
   * Called by an unregistered screen, with no authentication. Rate-limited per
   * client address so the table cannot be flooded by anything that can reach
   * the port.
   */
  mint(clientAddress = 'unknown'): MintedEnrolmentCode {
    const nowMs = this.clock.now().getTime()
    this.mintAttempts.enforce(clientAddress, nowMs, 'Enrolment codes are being requested too quickly')
    this.mintAttempts.record(clientAddress, nowMs)
    this.sweep(nowMs)

    const createdAt = new Date(nowMs).toISOString()
    const expiresAt = new Date(nowMs + ENROLMENT_CODE_LIFETIME_MS).toISOString()
    // A collision with a live code is vanishingly unlikely across 32^8, but a
    // unique violation must retry rather than surface as a 500 to a screen.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateEnrolmentCode()
      const pollToken = randomBytes(32).toString('base64url')
      try {
        this.sqlite.prepare(
          'INSERT INTO display_enrolment_codes (id, code_hash, poll_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
        ).run(randomBytes(16).toString('hex'), hashSecret(code), hashSecret(pollToken), createdAt, expiresAt)
      } catch (error) {
        if (isUniqueConstraint(error)) continue
        throw error
      }
      return { code, pollToken, expiresAt }
    }
    throw new AuthError(409, 'conflict', 'An enrolment code could not be allocated. Try again.')
  }

  /**
   * Called by the minting screen while it polls. The credential is handed over
   * exactly once: a second claim reports `expired`, so a captured response
   * cannot be replayed into a second working credential.
   */
  claim(pollToken: string): EnrolmentClaim {
    const nowMs = this.clock.now().getTime()
    this.sweep(nowMs)
    const presented = hashSecret(pollToken)
    const row = this.sqlite.prepare(
      'SELECT id, poll_token_hash, expires_at, redeemed_at, collected_at, display_id FROM display_enrolment_codes WHERE poll_token_hash = ?'
    ).get(presented) as { id: string, poll_token_hash: Buffer, expires_at: string, redeemed_at: string | null, collected_at: string | null, display_id: string | null } | undefined
    if (row === undefined || !safeEqual(presented, row.poll_token_hash)) return { status: 'expired' }

    if (row.redeemed_at === null) {
      return Date.parse(row.expires_at) <= nowMs ? { status: 'expired' } : { status: 'pending' }
    }

    // Single use, and only within the collection window: a captured claim
    // cannot be replayed into a second credential, and a screen that took an
    // hour to come back gets a fresh code rather than a stale adoption.
    if (row.collected_at !== null || row.display_id === null) return { status: 'expired' }
    if (Date.parse(row.redeemed_at) + ENROLMENT_COLLECTION_WINDOW_MS <= nowMs) return { status: 'expired' }
    const display = this.displays.find(row.display_id)
    // Revoked between adoption and collection: the credential would be inert
    // anyway, and handing it over would only confuse the screen.
    if (display === undefined || display.revokedAt !== null) return { status: 'expired' }

    // Mint in the same transaction that marks the row collected, conditioned on
    // it not already being so: two claims racing the same token get one
    // credential between them, never two.
    const credential = this.sqlite.transaction((): string | null => {
      const marked = this.sqlite.prepare(
        'UPDATE display_enrolment_codes SET collected_at = ? WHERE id = ? AND collected_at IS NULL'
      ).run(new Date(nowMs).toISOString(), row.id)
      if (marked.changes !== 1) return null
      return this.displays.issueCredential(display.id)
    })()
    if (credential === null) return { status: 'expired' }
    return { status: 'adopted', credential, display }
  }

  /**
   * Called by a parent's phone after scanning. Registers the display through
   * the ordinary `A03` path and returns it **without** the credential — that
   * goes to the screen through `claim`, never to the phone.
   */
  redeem(code: string, name: string, clientAddress = 'unknown'): DisplayDevice {
    const nowMs = this.clock.now().getTime()
    this.redeemFailures.enforce(clientAddress, nowMs, 'Enrolment attempts are temporarily throttled')
    // Every unusable code takes this same path — hash, indexed lookup, constant
    // -time compare — so a malformed or unknown code costs what a stale one
    // does and neither the message nor the timing tells them apart.
    const presented = hashSecret(normalizeEnrolmentCode(code))
    const row = this.sqlite.prepare(
      'SELECT id, code_hash, expires_at, redeemed_at FROM display_enrolment_codes WHERE code_hash = ?'
    ).get(presented) as { id: string, code_hash: Buffer, expires_at: string, redeemed_at: string | null } | undefined
    if (row === undefined || !safeEqual(presented, row.code_hash) || row.redeemed_at !== null || Date.parse(row.expires_at) <= nowMs) {
      this.redeemFailures.record(clientAddress, nowMs)
      throw new AuthError(401, 'unauthorized', ENROLMENT_REFUSAL)
    }

    const registered = this.sqlite.transaction((): DisplayDevice => {
      // No credential exists yet. The screen mints its own when it collects.
      const display = this.displays.registerAwaitingCredential({ name })
      // Conditioned on `redeemed_at IS NULL` so two phones racing the same code
      // cannot both register a screen: the loser's update matches nothing and
      // the whole transaction, registration included, rolls back.
      const result = this.sqlite.prepare(
        'UPDATE display_enrolment_codes SET redeemed_at = ?, display_id = ? WHERE id = ? AND redeemed_at IS NULL'
      ).run(new Date(nowMs).toISOString(), display.id, row.id)
      if (result.changes !== 1) throw new AuthError(401, 'unauthorized', ENROLMENT_REFUSAL)
      return display
    })()

    return registered
  }

  /**
   * Drops codes long past their expiry and credentials no screen came back for.
   * Single-use codes are worthless once dead, and an appliance that runs for
   * years should not accumulate them.
   */
  private sweep(nowMs: number): void {
    // A display that was redeemed but never collected within the window holds a
    // credential hash nobody has a preimage for. It can never connect, and on
    // the phone it reads as "registered, not connected" for ever. Remove it;
    // the enrolment row cascades with it. Displays registered by the older
    // A03 link path have no enrolment row and are untouched.
    this.sqlite.prepare(`
      DELETE FROM devices WHERE last_seen_at IS NULL AND revoked_at IS NULL AND id IN (
        SELECT display_id FROM display_enrolment_codes
        WHERE display_id IS NOT NULL AND redeemed_at IS NOT NULL AND collected_at IS NULL AND redeemed_at <= ?
      )
    `).run(new Date(nowMs - ENROLMENT_COLLECTION_WINDOW_MS).toISOString())
    this.sqlite.prepare('DELETE FROM display_enrolment_codes WHERE expires_at <= ?')
      .run(new Date(nowMs - ENROLMENT_ROW_RETENTION_MS).toISOString())
  }
}

/**
 * A sliding-window attempt counter keyed by client address. In-process by
 * design: one server owns this volume, so there is no second counter to keep in
 * step. Deliberately not the household-wide PIN backoff — locking every screen
 * out because one host misbehaved would be worse than the flooding it prevents.
 */
class AttemptWindow {
  private readonly attempts = new Map<string, number[]>()

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  enforce(key: string, nowMs: number, message: string): void {
    const recent = this.recent(key, nowMs)
    if (recent.length < this.limit) return
    throw new AuthError(429, 'rate_limited', message, Math.max(1, Math.ceil((recent[0] + this.windowMs - nowMs) / 1000)))
  }

  record(key: string, nowMs: number): void {
    this.attempts.set(key, [...this.recent(key, nowMs), nowMs])
  }

  private recent(key: string, nowMs: number): number[] {
    const kept = (this.attempts.get(key) ?? []).filter((at) => at > nowMs - this.windowMs)
    if (kept.length === 0) this.attempts.delete(key)
    else this.attempts.set(key, kept)
    return kept
  }
}

function generateEnrolmentCode(): string {
  // 32 divides 256, so a byte modulo the alphabet length is uniform.
  let code = ''
  for (const byte of randomBytes(ENROLMENT_CODE_LENGTH)) code += ENROLMENT_CODE_ALPHABET[byte % ENROLMENT_CODE_ALPHABET.length]
  return code
}

/**
 * What a parent typed, turned into what the screen showed. Spaces and hyphens a
 * human added for readability go, and the letters Crockford base32 omits fold
 * to the digits they are mistaken for.
 */
export function normalizeEnrolmentCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]+/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
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

function assertDeviceName(name: string, label: 'Display' | 'Phone'): string {
  const normalized = name.trim()
  if (normalized.length < 1 || normalized.length > 120) throw new AuthError(401, 'unauthorized', `${label} name must contain 1 to 120 characters`)
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

/** Deliberately builds an explicit object: credential_hash is never carried. */
function rowToParentDevice(row: unknown): ParentDevice {
  const record = row as Record<string, unknown>
  return {
    id: String(record.id), name: String(record.name),
    pairedAt: String(record.paired_at),
    lastSeenAt: record.last_seen_at === null ? null : String(record.last_seen_at),
    revokedAt: record.revoked_at === null ? null : String(record.revoked_at)
  }
}

function parseJson(value: unknown): unknown | null {
  return value === null || value === undefined ? null : JSON.parse(String(value))
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}
