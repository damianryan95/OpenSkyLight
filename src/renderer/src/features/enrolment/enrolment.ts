/**
 * Pure logic for the screen-initiated enrolment ceremony (ADR 0006).
 *
 * Deliberately free of DOM, timers and transport so the state machine that a
 * wall display runs unattended for hours can be exercised directly.  The poll
 * token never appears here: it is a secret held in a ref by the surface, and
 * nothing in this module may put it anywhere a render could reach.
 */

/** Poll cadence for the claim endpoint. Fast enough that a parent's scan feels
 * immediate, slow enough that an unadopted screen is not a traffic source. */
export const ENROLMENT_POLL_INTERVAL_MS = 2_500

/** How long the adoption confirmation stays up before the board is brought up.
 * ADR 0006 wants a hijacked first run to be visible, not merely logged. */
export const ENROLMENT_CONFIRMATION_MS = 7_000

/** Below this, a countdown reads as alarming rather than informative. */
const REFRESH_SOON_MS = 20_000

/**
 * How far past its stated expiry a code is kept before the screen rotates on
 * its own clock.
 *
 * Rotation is normally server-driven: the next claim reports `expired` and the
 * screen mints again. That ordering matters, because a parent who redeems a
 * second before expiry leaves a credential waiting against *this* poll token —
 * abandoning it would register a display that never collects its credential.
 * Rotating locally is therefore only the fallback for a server that has stopped
 * answering, and it waits long enough that a reachable server would have ruled
 * first.
 */
const LOCAL_EXPIRY_GRACE_MS = 15_000

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000]

/** A wall display has no reload button, so failing to mint can never become a
 * dead end — it backs off to a steady retry and stays there. */
export function retryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_DELAYS_MS.length) - 1
  return RETRY_DELAYS_MS[index]!
}

/** Crockford base32 excludes I, L, O and U so a code can be read aloud across a
 * room; grouping in fours is what makes it typable without losing your place. */
export function formatEnrolmentCode(code: string): string {
  const compact = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return (compact.match(/.{1,4}/g) ?? []).join(' ')
}

/**
 * The QR payload is a URL on purpose: a stock camera app opens the admin page,
 * and the OpenSkyLight app parses the same string to learn both the server
 * address and the code.  The code lives in the fragment so it is never sent to
 * the server nor written into any access log.
 */
export function enrolmentQrPayload(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/admin/#enrol=${code}`
}

export function millisecondsRemaining(expiresAt: string, now: number): number {
  const expiry = Date.parse(expiresAt)
  if (Number.isNaN(expiry)) return 0
  return Math.max(0, expiry - now)
}

/** True only once the server has had every chance to rotate the code itself. */
export function isLocallyExpired(expiresAt: string, now: number): boolean {
  const expiry = Date.parse(expiresAt)
  if (Number.isNaN(expiry)) return true
  return expiry + LOCAL_EXPIRY_GRACE_MS <= now
}

/** A parent who walks up mid-cycle must read the code changing as routine. */
export function describeRefresh(remainingMs: number): string {
  if (remainingMs <= REFRESH_SOON_MS) return 'This code refreshes in a moment — that is normal'
  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = `${totalSeconds % 60}`.padStart(2, '0')
  return `This code refreshes in ${minutes}:${seconds} — that is normal`
}

export type EnrolmentState =
  /** Asking the server for a code. `attempt` carries failed attempts forward so
   * backoff keeps growing across a long outage. */
  | { phase: 'minting'; attempt: number }
  | { phase: 'offline'; attempt: number; retryInMs: number }
  | { phase: 'showing'; code: string; expiresAt: string }
  | { phase: 'adopted'; displayName: string }

export type EnrolmentAction =
  | { type: 'mint' }
  | { type: 'minted'; code: string; expiresAt: string }
  | { type: 'mint_failed' }
  | { type: 'poll_pending' }
  | { type: 'expired' }
  | { type: 'poll_failed' }
  | { type: 'adopted'; displayName: string }

export const initialEnrolmentState: EnrolmentState = { phase: 'minting', attempt: 0 }

export function enrolmentReducer(state: EnrolmentState, action: EnrolmentAction): EnrolmentState {
  // Adoption is terminal: a late poll response must never take a registered
  // screen back to a QR it has already given away.
  if (state.phase === 'adopted') return state
  switch (action.type) {
    case 'mint':
      return state.phase === 'offline' ? { phase: 'minting', attempt: state.attempt } : state
    case 'minted':
      return { phase: 'showing', code: action.code, expiresAt: action.expiresAt }
    case 'mint_failed': {
      if (state.phase !== 'minting') return state
      const attempt = state.attempt + 1
      return { phase: 'offline', attempt, retryInMs: retryDelayMs(attempt) }
    }
    case 'expired':
      // Mint immediately: the wall must never sit on a dead QR, and an expiry
      // is evidence the server is answering, so backoff would be wrong here.
      return state.phase === 'showing' ? { phase: 'minting', attempt: 0 } : state
    case 'poll_failed':
    case 'poll_pending':
      // Keep the current code on screen. A transport blip does not invalidate
      // it, and blanking the QR would be worse than a slightly stale one.
      return state
    case 'adopted':
      return { phase: 'adopted', displayName: action.displayName }
    default:
      return state
  }
}
