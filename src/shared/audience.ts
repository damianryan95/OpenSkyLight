/** A minimal household person shape used to derive calendar audiences. */
export interface AudiencePerson {
  id: string
  name: string
  role: 'parent' | 'child'
  /** Omitted means active, which keeps this compatible with the current person model. */
  active?: boolean
}

export interface AudienceDerivationInput {
  /** The nullable person mapping of the calendar that supplied this event. */
  mappedPersonId: string | null | undefined
  title: string | null | undefined
  description: string | null | undefined
  people: readonly AudiencePerson[]
}

/**
 * Raised when two active children have the same normalized name. The caller must
 * make those names distinguishable before text inference can safely be used.
 */
export class AmbiguousChildNameError extends Error {
  readonly names: readonly string[]

  constructor(names: readonly string[]) {
    super(`Ambiguous child names: ${names.join(', ')}`)
    this.name = 'AmbiguousChildNameError'
    this.names = names
  }
}

/** Normalize names and event text consistently before comparison. */
export function normalizeAudienceText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** Remove Google-style description markup while retaining word boundaries. */
export function cleanAudienceDescription(value: string): string {
  return normalizeAudienceText(
    decodeHtmlEntities(
      value
        .replace(/<!--[\s\S]*?-->/gu, ' ')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
        .replace(/<\s*br\s*\/?>/giu, ' ')
        .replace(/<\/?(?:p|div|li|tr|td|th|h[1-6]|blockquote)\b[^>]*>/giu, ' ')
        .replace(/<[^>]*>/gu, ' ')
    )
  )
}

/** Return duplicated active-child names after normalization, for parent validation UI. */
export function findAmbiguousChildNames(people: readonly AudiencePerson[]): string[] {
  const counts = new Map<string, number>()
  for (const person of people) {
    if (person.role !== 'child' || person.active === false) continue
    const name = normalizeAudienceText(person.name)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].filter(([, count]) => count > 1).map(([name]) => name).sort()
}

/**
 * Derive an event's personal audience from its calendar mapping and child names
 * in its title/description. An empty result deliberately represents Family-only.
 */
export function deriveEffectivePersonIds(input: AudienceDerivationInput): string[] {
  const ambiguousNames = findAmbiguousChildNames(input.people)
  if (ambiguousNames.length > 0) throw new AmbiguousChildNameError(ambiguousNames)

  const personIds = new Set<string>()
  if (input.mappedPersonId) personIds.add(input.mappedPersonId)

  const text = `${cleanAudienceDescription(input.title ?? '')} ${cleanAudienceDescription(input.description ?? '')}`.trim()
  for (const person of input.people) {
    if (person.role !== 'child' || person.active === false) continue
    const name = normalizeAudienceText(person.name)
    if (name && containsWholeName(text, name)) personIds.add(person.id)
  }

  return [...personIds]
}

function containsWholeName(text: string, name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}])${escapedName}(?=$|[^\\p{L}\\p{N}\\p{M}])`, 'u').test(text)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|[0-9]+);?/giu, (_, encoded: string) => {
      const point = encoded[0].toLowerCase() === 'x' ? Number.parseInt(encoded.slice(1), 16) : Number.parseInt(encoded, 10)
      try {
        return String.fromCodePoint(point)
      } catch {
        return ' '
      }
    })
    .replace(/&(nbsp|amp|lt|gt|quot|apos);?/giu, (_, entity: string) => {
      const entities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
      return entities[entity.toLowerCase()]
    })
}
