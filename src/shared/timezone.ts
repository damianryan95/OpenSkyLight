import { DateTime } from 'luxon'

/** Calendar providers occasionally supply fixed offsets such as GMT+08:00, while Luxon
 * accepts their equivalent UTC+08:00 form rather than the GMT spelling. */
export function normalizeTimeZone(value: string | null | undefined, fallback = 'UTC'): string {
  const raw = value?.trim() || fallback
  const fixedOffset = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(raw)
  const candidate = fixedOffset === null ? raw : `UTC${fixedOffset[1]}${fixedOffset[2].padStart(2, '0')}${fixedOffset[3] ? `:${fixedOffset[3]}` : ''}`
  if (DateTime.now().setZone(candidate).isValid) return candidate
  if (raw !== fallback) return normalizeTimeZone(fallback, 'UTC')
  return 'UTC'
}
