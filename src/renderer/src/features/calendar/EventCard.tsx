import type { OccurrenceDto, PersonDto } from '@shared/types'
import { formatTime, textOn } from '../../lib/format'
import { MapPinIcon, RepeatIcon } from '../../components/icons'

export function PersonDots({ personIds, peopleById }: { personIds: string[]; peopleById: Map<string, PersonDto> }) {
  if (personIds.length < 2) return null
  return (
    <span className="ml-auto flex shrink-0 -space-x-1.5">
      {personIds.slice(0, 4).map((id) => {
        const p = peopleById.get(id)
        if (!p) return null
        return (
          <span
            key={id}
            className="h-3.5 w-3.5 rounded-full ring-2 ring-card"
            style={{ backgroundColor: p.color }}
          />
        )
      })}
    </span>
  )
}

/**
 * `onSelect` is what makes a card editable (`N15`). It is omitted while the
 * display is locked, so a card stays a card: a child tapping the wall gets
 * nothing, rather than an editor that refuses to save.
 */
export function EventCard({
  occ,
  color,
  timeFormat,
  peopleById,
  size = 'md',
  onSelect
}: {
  occ: OccurrenceDto
  color: string
  timeFormat: '12h' | '24h'
  peopleById: Map<string, PersonDto>
  size?: 'md' | 'lg'
  onSelect?: (occ: OccurrenceDto) => void
}) {
  const tap = onSelect === undefined ? {} : { onClick: () => onSelect(occ), role: 'button', tabIndex: 0 }
  if (occ.allDay) {
    return (
      <div
        {...tap}
        className={`pressable flex w-full items-center gap-2 rounded-xl px-3 text-left font-bold shadow-card ${
          size === 'lg' ? 'min-h-14 text-lg' : 'min-h-11 text-[15px]'
        }`}
        style={{ backgroundColor: color, color: textOn(color) }}
      >
        <span className="truncate">{occ.title}</span>
        {occ.isRecurring && <RepeatIcon size={14} className="shrink-0 opacity-70" />}
      </div>
    )
  }
  return (
    <div
      {...tap}
      className={`pressable w-full rounded-xl bg-card text-left shadow-card ${
        size === 'lg' ? 'p-4' : 'px-3 py-2'
      }`}
      style={{ borderLeft: `5px solid ${color}` }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`font-extrabold ${size === 'lg' ? 'text-base' : 'text-[13px]'}`} style={{ color }}>
          {formatTime(occ.start, timeFormat)}
        </span>
        {occ.isRecurring && <RepeatIcon size={13} className="shrink-0 text-ink-faint" />}
        <PersonDots personIds={occ.personIds} peopleById={peopleById} />
      </div>
      <div className={`truncate font-bold text-ink ${size === 'lg' ? 'text-xl' : 'text-[15px]'}`}>{occ.title}</div>
      {size === 'lg' && occ.location && (
        <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-ink-soft">
          <MapPinIcon size={14} />
          <span className="truncate">{occ.location}</span>
        </div>
      )}
    </div>
  )
}
