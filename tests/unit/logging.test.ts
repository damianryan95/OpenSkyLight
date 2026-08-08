import { describe, expect, it } from 'vitest'
import { safeLogErrorMessage } from '../../src/server/logging'

describe('server log redaction', () => {
  it('never serializes PINs, sessions, display credentials, or Google tokens from unexpected errors', () => {
    const sensitive = new Error('pin=1234 cookie=osl_parent_session=session-secret Authorization: Bearer device-credential refresh_token=google-token client_secret=oauth-secret')
    const output = JSON.stringify({ event: 'server.start_failed', error: safeLogErrorMessage(sensitive) })
    for (const value of ['1234', 'session-secret', 'device-credential', 'google-token', 'oauth-secret']) expect(output).not.toContain(value)
  })
})
