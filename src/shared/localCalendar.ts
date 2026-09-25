/**
 * The board's own calendar (ADR 0007). Seeded once in migration 013 with these
 * exact ids, so both the server and its tests can address it without a lookup
 * by name — a household may rename it, and a name is not an identity.
 *
 * An event authored on a display or in the companion lands here first and always.
 * Syncing it outward is the special case, not this.
 */
export const LOCAL_CALENDAR_SOURCE_ID = 'osl-local-source'
export const LOCAL_CALENDAR_ID = 'osl-local-calendar'

/** What the household sees before anybody renames it. */
export const LOCAL_CALENDAR_DEFAULT_NAME = 'OpenSkyLight'
