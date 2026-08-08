/**
 * The extracted browser application is always a registered wall display.
 * Electron continues to host the legacy all-in-one renderer while the parent
 * administration application has its own bundle.  This is a UX boundary only:
 * the server remains authoritative for every capability.
 */
export function isDisplayClient(): boolean {
  return typeof window !== 'undefined' && window.osl === undefined
}
