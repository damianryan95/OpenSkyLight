import { readEnrolmentCodeFromHash } from './enrolment'

/**
 * A code that arrived in the address bar, held in memory for the length of one
 * page load and no longer.
 *
 * A parent who scans the screen's QR with their phone's ordinary camera — the
 * likeliest thing to happen, since it needs nothing installed — lands on
 * `/admin/#enrol=…`. They may still have to enter the household PIN before the
 * administration page appears, so the code has to survive that screen. It does
 * so in a module variable: never in `localStorage`, never in `sessionStorage`,
 * never in a log, and gone the moment the tab is closed.
 *
 * The fragment itself is scrubbed immediately, so the code does not sit in the
 * address bar to be read over a shoulder or kept in browser history.
 */
let pending: string | null = null

export function captureEnrolmentCodeFromLocation(): void {
  const code = readEnrolmentCodeFromHash(window.location.hash)
  if (code === null) return
  pending = code
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
}

/** Deliberately a pure read. It is called from React state initialisers, which
 * run twice under StrictMode, and a consuming read there would lose the code on
 * the second pass in development and nowhere else — the worst kind of bug. */
export function peekPendingEnrolmentCode(): string | null {
  return pending
}

/** Called once the flow that will spend the code holds it. A code is single
 * use, so nothing after this should find it lying around. */
export function clearPendingEnrolmentCode(): void {
  pending = null
}
