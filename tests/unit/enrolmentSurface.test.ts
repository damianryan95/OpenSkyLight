import { describe, expect, it } from 'vitest'
import {
  describeRefresh,
  enrolmentQrPayload,
  enrolmentReducer,
  formatEnrolmentCode,
  initialEnrolmentState,
  isLocallyExpired,
  millisecondsRemaining,
  retryDelayMs,
  type EnrolmentAction,
  type EnrolmentState
} from '../../src/renderer/src/features/enrolment/enrolment'

function reduce(state: EnrolmentState, actions: EnrolmentAction[]): EnrolmentState {
  return actions.reduce(enrolmentReducer, state)
}

describe('enrolment code presentation', () => {
  it('groups an eight character code into two readable blocks', () => {
    expect(formatEnrolmentCode('ABCD1234')).toBe('ABCD 1234')
  })

  it('normalises case and ignores separators the server may already have added', () => {
    expect(formatEnrolmentCode('abcd-1234')).toBe('ABCD 1234')
    expect(formatEnrolmentCode('ABCD 1234')).toBe('ABCD 1234')
  })

  it('never renders an empty group for a short or empty code', () => {
    expect(formatEnrolmentCode('')).toBe('')
    expect(formatEnrolmentCode('AB2')).toBe('AB2')
    expect(formatEnrolmentCode('ABCDE')).toBe('ABCD E')
  })
})

describe('QR payload', () => {
  it('is the admin URL with the code in the fragment, never a query string', () => {
    const payload = enrolmentQrPayload('http://192.168.1.50:3000', 'ABCD1234')
    expect(payload).toBe('http://192.168.1.50:3000/admin/#enrol=ABCD1234')
    expect(payload).not.toContain('?')
  })

  it('does not double the separator when the origin carries a trailing slash', () => {
    expect(enrolmentQrPayload('http://osl.local/', 'ABCD1234')).toBe('http://osl.local/admin/#enrol=ABCD1234')
  })

  it('carries only the public code — nothing resembling a credential', () => {
    const payload = enrolmentQrPayload('https://board.example', 'J8K4MN2P')
    expect(payload.split('#enrol=')[1]).toBe('J8K4MN2P')
  })
})

describe('refresh countdown', () => {
  it('reads as a clock while there is real time left', () => {
    expect(describeRefresh(4 * 60_000 + 32_000)).toBe('This code refreshes in 4:32 — that is normal')
    expect(describeRefresh(61_000)).toBe('This code refreshes in 1:01 — that is normal')
  })

  it('stops counting the last seconds down rather than alarming a passer-by', () => {
    expect(describeRefresh(9_000)).toBe('This code refreshes in a moment — that is normal')
    expect(describeRefresh(0)).toBe('This code refreshes in a moment — that is normal')
  })

  it('treats an unparseable expiry as already expired rather than infinite', () => {
    expect(millisecondsRemaining('not-a-date', Date.now())).toBe(0)
    expect(millisecondsRemaining('2026-09-24T10:05:00.000Z', Date.parse('2026-09-24T10:00:00.000Z'))).toBe(300_000)
    expect(millisecondsRemaining('2026-09-24T10:00:00.000Z', Date.parse('2026-09-24T10:05:00.000Z'))).toBe(0)
  })
})

describe('local expiry fallback', () => {
  const expiresAt = '2026-09-24T10:05:00.000Z'
  const at = (iso: string): number => Date.parse(iso)

  it('leaves rotation to the server while the code is merely past its expiry', () => {
    // A parent who redeemed a second before expiry has a credential waiting
    // against this poll token; the next claim must be allowed to collect it.
    expect(isLocallyExpired(expiresAt, at('2026-09-24T10:04:59.000Z'))).toBe(false)
    expect(isLocallyExpired(expiresAt, at('2026-09-24T10:05:05.000Z'))).toBe(false)
  })

  it('rotates on the screen clock once a reachable server would have ruled', () => {
    expect(isLocallyExpired(expiresAt, at('2026-09-24T10:05:15.000Z'))).toBe(true)
    expect(isLocallyExpired(expiresAt, at('2026-09-24T10:09:00.000Z'))).toBe(true)
  })

  it('treats an unreadable expiry as expired rather than trusting it forever', () => {
    expect(isLocallyExpired('', Date.now())).toBe(true)
  })
})

describe('mint backoff', () => {
  it('grows and then settles, so an unreachable server is retried forever', () => {
    expect(retryDelayMs(1)).toBe(2_000)
    expect(retryDelayMs(2)).toBe(4_000)
    expect(retryDelayMs(5)).toBe(30_000)
    expect(retryDelayMs(99)).toBe(30_000)
    expect(retryDelayMs(0)).toBe(2_000)
  })
})

describe('enrolment state machine', () => {
  it('starts by asking for a code', () => {
    expect(initialEnrolmentState).toEqual({ phase: 'minting', attempt: 0 })
  })

  it('shows the code it was granted', () => {
    const state = enrolmentReducer(initialEnrolmentState, { type: 'minted', code: 'ABCD1234', expiresAt: 'later' })
    expect(state).toEqual({ phase: 'showing', code: 'ABCD1234', expiresAt: 'later' })
  })

  it('backs off through offline and returns to minting, never stopping', () => {
    const offline = enrolmentReducer(initialEnrolmentState, { type: 'mint_failed' })
    expect(offline).toEqual({ phase: 'offline', attempt: 1, retryInMs: 2_000 })
    const retrying = enrolmentReducer(offline, { type: 'mint' })
    expect(retrying).toEqual({ phase: 'minting', attempt: 1 })
    expect(enrolmentReducer(retrying, { type: 'mint_failed' })).toEqual({ phase: 'offline', attempt: 2, retryInMs: 4_000 })
  })

  it('mints again immediately on expiry so the wall never holds a dead code', () => {
    const showing = reduce(initialEnrolmentState, [{ type: 'minted', code: 'ABCD1234', expiresAt: 'later' }])
    expect(enrolmentReducer(showing, { type: 'expired' })).toEqual({ phase: 'minting', attempt: 0 })
  })

  it('keeps the current code on screen through a transport blip', () => {
    const showing = reduce(initialEnrolmentState, [{ type: 'minted', code: 'ABCD1234', expiresAt: 'later' }])
    expect(enrolmentReducer(showing, { type: 'poll_failed' })).toBe(showing)
    expect(enrolmentReducer(showing, { type: 'poll_pending' })).toBe(showing)
  })

  it('treats adoption as terminal — a late response cannot re-show a QR', () => {
    const adopted = reduce(initialEnrolmentState, [
      { type: 'minted', code: 'ABCD1234', expiresAt: 'later' },
      { type: 'adopted', displayName: 'Kitchen wall' }
    ])
    expect(adopted).toEqual({ phase: 'adopted', displayName: 'Kitchen wall' })
    for (const action of [
      { type: 'expired' },
      { type: 'mint' },
      { type: 'mint_failed' },
      { type: 'minted', code: 'WXYZ9876', expiresAt: 'later' },
      { type: 'poll_failed' }
    ] satisfies EnrolmentAction[]) {
      expect(enrolmentReducer(adopted, action)).toBe(adopted)
    }
  })

  it('ignores actions that do not belong to the current phase', () => {
    const offline = enrolmentReducer(initialEnrolmentState, { type: 'mint_failed' })
    expect(enrolmentReducer(offline, { type: 'expired' })).toBe(offline)
    expect(enrolmentReducer(initialEnrolmentState, { type: 'mint' })).toBe(initialEnrolmentState)
  })
})
