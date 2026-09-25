import { useEffect, useReducer, useRef, useState } from 'react'
import { claimEnrolment, persistDisplayCredential, requestEnrolmentCode } from '../../api/browser'
import {
  ENROLMENT_POLL_INTERVAL_MS,
  ENROLMENT_RESUME_KEY,
  enrolmentReducer,
  initialEnrolmentState,
  isLocallyExpired,
  restoreEnrolment,
  type EnrolmentState
} from './enrolment'

function readResume(): ReturnType<typeof restoreEnrolment> {
  try { return restoreEnrolment(localStorage.getItem(ENROLMENT_RESUME_KEY), Date.now()) } catch { return null }
}
function writeResume(code: string, pollToken: string, expiresAt: string): void {
  try { localStorage.setItem(ENROLMENT_RESUME_KEY, JSON.stringify({ code, pollToken, expiresAt })) } catch { /* a screen with no storage still works, it just re-mints */ }
}
function clearResume(): void {
  try { localStorage.removeItem(ENROLMENT_RESUME_KEY) } catch { /* nothing to clear */ }
}

/**
 * Drives the enrolment state machine against the server.
 *
 * The poll token lives in a ref and never enters React state: state is what
 * gets rendered, and ADR 0006's whole safety argument rests on the wall showing
 * the public code and nothing else.
 */
export function useEnrolment(): { state: EnrolmentState; now: number } {
  // Resume the code this screen was already showing, if any: a reload must not
  // abandon an adoption a parent may have just made against it.
  const resumed = useRef(readResume())
  const [state, dispatch] = useReducer(enrolmentReducer, resumed.current?.state ?? initialEnrolmentState)
  const pollToken = useRef<string | null>(resumed.current?.pollToken ?? null)
  const [now, setNow] = useState(() => Date.now())

  const phase = state.phase
  const attempt = state.phase === 'minting' || state.phase === 'offline' ? state.attempt : 0
  const retryInMs = state.phase === 'offline' ? state.retryInMs : 0
  const activeCode = state.phase === 'showing' ? state.code : null
  const expiresAt = state.phase === 'showing' ? state.expiresAt : null

  useEffect(() => {
    if (phase !== 'minting') return
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      try {
        const grant = await requestEnrolmentCode(controller.signal)
        if (cancelled) return
        pollToken.current = grant.pollToken
        writeResume(grant.code, grant.pollToken, grant.expiresAt)
        dispatch({ type: 'minted', code: grant.code, expiresAt: grant.expiresAt })
      } catch {
        // The body is never inspected or surfaced: a remote error can echo
        // credentials, and the screen has only one thing to say regardless.
        if (!cancelled) dispatch({ type: 'mint_failed' })
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [phase, attempt])

  useEffect(() => {
    if (phase !== 'offline') return
    const timer = window.setTimeout(() => dispatch({ type: 'mint' }), retryInMs)
    return () => window.clearTimeout(timer)
  }, [phase, attempt, retryInMs])

  useEffect(() => {
    if (activeCode === null) return
    const controller = new AbortController()
    let cancelled = false
    let timer = 0
    const schedule = (): void => { timer = window.setTimeout(() => void poll(), ENROLMENT_POLL_INTERVAL_MS) }
    const poll = async (): Promise<void> => {
      const token = pollToken.current
      // No token means this code can never be adopted; rotate rather than poll
      // forever against something the server will not recognise.
      if (token === null) { dispatch({ type: 'expired' }); return }
      try {
        const claim = await claimEnrolment(token, controller.signal)
        if (cancelled) return
        if (claim.status === 'adopted') {
          // The credential is returned exactly once. Persist it before anything
          // else in this component gets the chance to fail.
          persistDisplayCredential(claim.credential, claim.display.id)
          pollToken.current = null
          clearResume()
          dispatch({ type: 'adopted', displayName: claim.display.name })
          return
        }
        if (claim.status === 'expired') { pollToken.current = null; clearResume(); dispatch({ type: 'expired' }); return }
        dispatch({ type: 'poll_pending' })
      } catch {
        if (cancelled) return
        dispatch({ type: 'poll_failed' })
      }
      schedule()
    }
    schedule()
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer) }
  }, [activeCode])

  useEffect(() => {
    if (expiresAt === null) return
    setNow(Date.now())
    const interval = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      // Rotate on the screen's own clock only once the server has had its
      // chance to: a code redeemed just before expiry still has a credential
      // waiting against this poll token, and dropping it would register a
      // display that never collects one.
      if (isLocallyExpired(expiresAt, current)) { clearResume(); dispatch({ type: 'expired' }) }
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [expiresAt])

  return { state, now }
}
