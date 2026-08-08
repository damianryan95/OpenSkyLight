/**
 * A deliberately small, family-friendly set.  IDs—not emoji—are stored in the
 * database, so presentation can change later without touching chore records.
 */
export const CHORE_ICON_OPTIONS = [
  { id: 'toothbrush', label: 'Brush teeth', symbol: '🪥', keywords: ['brush teeth', 'toothbrush', 'teeth', 'tooth'] },
  { id: 'bed', label: 'Make bed', symbol: '🛏️', keywords: ['make bed', 'bedroom', 'bed'] },
  { id: 'shirt', label: 'Get dressed', symbol: '👕', keywords: ['get dressed', 'dress', 'clothes', 'uniform'] },
  { id: 'shower', label: 'Wash', symbol: '🚿', keywords: ['shower', 'bath', 'wash hair', 'wash'] },
  { id: 'dishes', label: 'Dishes', symbol: '🍽️', keywords: ['dishwasher', 'wash dishes', 'dishes', 'dish', 'plates'] },
  { id: 'broom', label: 'Clean', symbol: '🧹', keywords: ['vacuum', 'sweep', 'mop', 'clean', 'tidy'] },
  { id: 'laundry', label: 'Laundry', symbol: '🧺', keywords: ['fold laundry', 'laundry', 'washing', 'clothes'] },
  { id: 'paw', label: 'Pet care', symbol: '🐾', keywords: ['feed dog', 'feed cat', 'feed pet', 'walk dog', 'pet', 'dog', 'cat'] },
  { id: 'garden', label: 'Garden', symbol: '🌱', keywords: ['mow', 'weed', 'garden', 'plants', 'lawn'] },
  { id: 'bin', label: 'Bins', symbol: '🗑️', keywords: ['rubbish', 'garbage', 'trash', 'bin', 'recycling'] },
  { id: 'book', label: 'Homework', symbol: '📚', keywords: ['homework', 'reading', 'read', 'school', 'study'] },
  { id: 'pencil', label: 'Writing', symbol: '✏️', keywords: ['write', 'spelling', 'practice'] },
  { id: 'backpack', label: 'Pack bag', symbol: '🎒', keywords: ['pack bag', 'school bag', 'backpack', 'pack'] },
  { id: 'apple', label: 'Food', symbol: '🍎', keywords: ['lunch', 'breakfast', 'snack', 'food'] },
  { id: 'clock', label: 'Routine', symbol: '⏰', keywords: ['morning', 'evening', 'routine'] },
  { id: 'sparkles', label: 'Other', symbol: '✨', keywords: [] }
] as const

export const CHORE_ICON_IDS = CHORE_ICON_OPTIONS.map((icon) => icon.id) as unknown as readonly [string, ...string[]]
export type ChoreIconId = typeof CHORE_ICON_OPTIONS[number]['id']

export function choreIconSymbol(icon: string | null | undefined): string {
  return CHORE_ICON_OPTIONS.find((option) => option.id === icon)?.symbol ?? '✨'
}

/** First matching phrase wins; longer phrases avoid "feed dog" becoming just "dog". */
export function suggestChoreIcon(title: string): ChoreIconId | null {
  const normalized = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!normalized) return null
  const match = CHORE_ICON_OPTIONS
    .flatMap((icon) => icon.keywords.map((keyword) => ({ id: icon.id, keyword })))
    .sort((a, b) => b.keyword.length - a.keyword.length)
    .find(({ keyword }) => normalized.includes(keyword))
  return (match?.id as ChoreIconId | undefined) ?? null
}
