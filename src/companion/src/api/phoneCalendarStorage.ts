/**
 * What this phone remembers about pushing its own calendars. A leaf module on
 * purpose: both the API client and the sync service need to clear it, and
 * routing that through either of them would make them import each other.
 *
 * None of this is secret — it is an id, a timestamp and a clock correction —
 * but all of it belongs to one household, so unpairing forgets the lot.
 */
const SOURCE_ID_KEY = 'osl.phoneCalendar.sourceId'
const LAST_PUSHED_AT_KEY = 'osl.phoneCalendar.lastPushedAt'
const CLOCK_OFFSET_KEY = 'osl.phoneCalendar.clockOffsetMs'
/** The name the parent gave this phone when pairing, reused so the household
 * sees "Mum's phone" in its calendar list rather than a second "This phone". */
const DEVICE_NAME_KEY = 'osl.parentDeviceName'

export function getPhoneSourceId(): string | null {
  return localStorage.getItem(SOURCE_ID_KEY)
}

export function setPhoneSourceId(id: string): void {
  localStorage.setItem(SOURCE_ID_KEY, id)
}

export function clearPhoneSourceId(): void {
  localStorage.removeItem(SOURCE_ID_KEY)
}

export function getLastPushedAt(): string | null {
  return localStorage.getItem(LAST_PUSHED_AT_KEY)
}

export function setLastPushedAt(value: string): void {
  localStorage.setItem(LAST_PUSHED_AT_KEY, value)
}

/** Kept across app launches so a phone whose clock genuinely disagrees with the
 * household server does not have to learn that again from a refused push every
 * single time it is opened. */
export function getClockOffsetMs(): number {
  const raw = Number(localStorage.getItem(CLOCK_OFFSET_KEY))
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

export function setClockOffsetMs(value: number): void {
  localStorage.setItem(CLOCK_OFFSET_KEY, String(Math.max(0, Math.round(value))))
}

export function getPairedDeviceName(): string | null {
  const name = localStorage.getItem(DEVICE_NAME_KEY)
  return name === null || name.trim() === '' ? null : name.trim()
}

export function setPairedDeviceName(name: string): void {
  localStorage.setItem(DEVICE_NAME_KEY, name.trim())
}

/** Called when a phone forgets its household. Leaving the source id behind
 * would have the app push this phone's calendar into whichever household it
 * paired with next, at an id that means something entirely different there. */
export function clearPhoneCalendarState(): void {
  localStorage.removeItem(SOURCE_ID_KEY)
  localStorage.removeItem(LAST_PUSHED_AT_KEY)
  localStorage.removeItem(CLOCK_OFFSET_KEY)
  localStorage.removeItem(DEVICE_NAME_KEY)
}
