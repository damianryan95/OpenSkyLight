import { ApiError } from './client'

/**
 * The pure half of screen enrolment (ADR 0006): what a scanned QR means, what a
 * hand-typed code means, and which of the three redemption cases the household
 * is in. Nothing here touches the network, the camera, or the DOM, because
 * every one of these decisions has to be testable without a phone in the room.
 */

/** The kiosk mints Crockford base32, which drops I, L, O and U precisely so a
 * code read off a wall at four metres cannot be mistyped into a different one. */
const CODE_LENGTH = 8
const CODE_ALPHABET = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/

/**
 * Accepts what a parent actually types — lower case, spaces, the hyphen they
 * assume is in there, and the letters Crockford removed for being ambiguous
 * with digits. Refusing those would be refusing a correct code on a technicality.
 *
 * `U` is not mapped: it is excluded from the alphabet but nothing else looks
 * like it, so a `U` means the code was misread rather than mistranscribed, and
 * guessing at it would redeem some other screen's code.
 */
export function normaliseEnrolmentCode(input: string): string | null {
  const compact = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
  if (compact.length !== CODE_LENGTH || !CODE_ALPHABET.test(compact)) return null
  return compact
}

/**
 * The same `#enrol=` fragment, read out of an address bar rather than a camera.
 *
 * The QR is a URL deliberately, so a parent who points their phone's ordinary
 * camera at the screen — having installed nothing — is taken to `/admin/` with
 * the code already in hand. Ignoring the fragment there would leave them
 * looking at an administration page with no idea why.
 */
export function readEnrolmentCodeFromHash(hash: string): string | null {
  const match = /[#&]enrol=([^&]*)/.exec(hash)
  if (match === null) return null
  try {
    return normaliseEnrolmentCode(decodeURIComponent(match[1]))
  } catch {
    return null
  }
}

export interface EnrolmentScan {
  /** Where the screen said its household server is — an origin, no trailing slash. */
  serverAddress: string
  code: string
}

/**
 * The QR encodes `{serverOrigin}/admin/#enrol={code}`, so a single scan carries
 * both the code and the address of the household server. That second half is
 * the reason this ceremony exists at all: it is how a phone that has never
 * heard of this household learns where to find it, with nobody typing an IP
 * address.
 *
 * Anything else — a Wi-Fi QR, a product barcode, a URL with no fragment — is
 * refused rather than half-understood.
 */
export function parseEnrolmentQr(payload: string): EnrolmentScan | null {
  let url: URL
  try {
    url = new URL(payload.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const code = readEnrolmentCodeFromHash(url.hash)
  if (code === null) return null
  // `origin` is already scheme://host[:port] with no path, which is exactly the
  // base URL shape the API client stores.
  return { serverAddress: url.origin, code }
}

/** What this phone knows about the household before the code is redeemed. The
 * browser at `/admin/` is always paired — it is served by the household server
 * and carries its session — so only the installed app reaches the other arm. */
export type HouseholdState =
  | { paired: true; serverAddress: string }
  | { paired: false; configured: boolean }

export type EnrolmentStep =
  /** Case 2. Redeem straight away, against the server this phone already uses. */
  | { kind: 'name-the-screen'; serverAddress: string; addressMismatch: boolean }
  /** Case 3. The scan supplied the address; the parent still has to supply the PIN. */
  | { kind: 'pair-this-phone'; serverAddress: string }
  /** Case 1. Not implementable here yet — say so rather than failing obscurely. */
  | { kind: 'household-not-set-up'; serverAddress: string }

/**
 * The three cases of ADR 0006, decided from household state rather than from a
 * flag, which is what makes "adding the fourth screen must not re-run setup"
 * fall out instead of needing to be remembered.
 */
export function decideEnrolmentStep(scan: EnrolmentScan, state: HouseholdState): EnrolmentStep {
  if (state.paired) {
    return {
      kind: 'name-the-screen',
      // Redeem against the address this phone is already authenticated with:
      // the credential is only good there, and the scanned address may be the
      // same box reached by another name.
      serverAddress: state.serverAddress,
      addressMismatch: state.serverAddress !== '' && state.serverAddress !== scan.serverAddress
    }
  }
  if (state.configured) return { kind: 'pair-this-phone', serverAddress: scan.serverAddress }
  return { kind: 'household-not-set-up', serverAddress: scan.serverAddress }
}

/**
 * A refused code is refused identically whether it was wrong, expired or
 * already used — deliberately, so a guesser learns nothing. That leaves the
 * phone unable to say *why*, so it says what to do instead, which is the same
 * thing in all three cases: look at the screen, it is showing a fresh one.
 */
export function explainEnrolmentFailure(reason: unknown, serverAddress: string): string {
  if (!(reason instanceof ApiError)) {
    return `Nothing answered at ${serverAddress}. Check this phone is on the same home Wi-Fi as the OpenSkyLight box rather than mobile data, then try again.`
  }
  if (reason.status === 429) {
    return reason.retryAfterSeconds === undefined
      ? 'Too many attempts have been made. Wait a minute, then try again.'
      : `Too many attempts have been made. Wait ${reason.retryAfterSeconds} seconds, then try again.`
  }
  if (reason.status === 401 || reason.status === 403) {
    return 'This phone is no longer allowed to administer the household. Connect it again with the household PIN, then add the screen.'
  }
  // Everything else, 404 included, is deliberately one message. The server
  // refuses a wrong, expired and already-used code identically so a guesser
  // learns nothing, and inventing a distinction here would only mean telling a
  // parent something the phone cannot actually know.
  return 'That code did not work — codes last only a few minutes, so the one you used has almost certainly expired. The screen is already showing a new one: read it again.'
}
