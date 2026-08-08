/**
 * Error strings from OAuth providers and HTTP clients can echo request URLs,
 * headers, or token values. Logs are operational diagnostics, not a secret
 * transport, so deliberately keep unexpected error details out of them.
 */
export function safeLogErrorMessage(_error: unknown): string {
  return 'Internal error (details withheld to protect credentials).'
}
