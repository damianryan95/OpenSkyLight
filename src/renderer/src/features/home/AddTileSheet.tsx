import { useState } from 'react'
import type { HomeTile, HomeTileType } from '@shared/types'
import { findFreeSpot, TILE_SPECS } from '@shared/home'
import { PRESET_FEEDS } from '@shared/rss'
import { uuidv7 } from '@shared/uuid'
import { useLists } from '../../api/hooks'
import { useToasts } from '../../stores/toastStore'
import { FieldLabel, Sheet } from '../../components/ui'
import { TILE_REGISTRY } from './tileRegistry'

const TILE_TYPES = Object.keys(TILE_REGISTRY) as HomeTileType[]
type PickerStep = null | 'list' | 'news'

export function AddTileSheet({
  open,
  layout,
  onClose,
  onAdd
}: {
  open: boolean
  layout: HomeTile[]
  onClose: () => void
  onAdd: (tile: HomeTile) => void
}) {
  const { data: lists = [] } = useLists()
  const pushToast = useToasts((s) => s.push)
  const [picker, setPicker] = useState<PickerStep>(null)

  const place = (type: HomeTileType, config?: HomeTile['config']): void => {
    const spec = TILE_SPECS[type]
    const spot =
      findFreeSpot(layout, spec.defaultW, spec.defaultH) ?? findFreeSpot(layout, spec.minW, spec.minH)
    if (!spot) {
      pushToast('No room on the grid — remove or shrink a tile first')
      return
    }
    const fitsDefault = findFreeSpot(layout, spec.defaultW, spec.defaultH) !== null
    onAdd({
      id: uuidv7(),
      type,
      x: spot.x,
      y: spot.y,
      w: fitsDefault ? spec.defaultW : spec.minW,
      h: fitsDefault ? spec.defaultH : spec.minH,
      ...(config ? { config } : {})
    })
    setPicker(null)
    onClose()
  }

  const title =
    picker === 'list'
      ? 'Which list?'
      : picker === 'news'
        ? 'Which news feed?'
        : 'Add a tile'

  return (
    <Sheet
      open={open}
      onClose={() => {
        setPicker(null)
        onClose()
      }}
      title={title}
    >
      {picker === 'list' ? (
        <div className="flex flex-col gap-2 pb-2">
          {lists.length === 0 && (
            <p className="text-base font-semibold text-ink-faint">Create a list on the Lists screen first.</p>
          )}
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => place('list', { listId: l.id })}
              className="pressable flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-4 text-left"
            >
              <span className="h-5 w-5 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="text-lg font-bold">{l.name}</span>
            </button>
          ))}
        </div>
      ) : picker === 'news' ? (
        <div className="flex flex-col gap-4 pb-2">
          {(['us', 'world'] as const).map((region) => (
            <div key={region}>
              <FieldLabel>{region === 'us' ? 'United States' : 'World'}</FieldLabel>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PRESET_FEEDS.filter((f) => f.region === region).map((feed) => (
                  <button
                    key={feed.id}
                    type="button"
                    onClick={() => place('news', { feedId: feed.id })}
                    className="pressable rounded-2xl bg-paper-deep/50 p-4 text-left text-lg font-bold"
                  >
                    {feed.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2">
          {TILE_TYPES.map((type) => {
            const meta = TILE_REGISTRY[type]
            const spec = TILE_SPECS[type]
            const alreadyPlaced = !spec.allowMultiple && layout.some((t) => t.type === type)
            return (
              <button
                key={type}
                type="button"
                disabled={alreadyPlaced}
                onClick={() =>
                  type === 'list' || type === 'news'
                    ? setPicker(type)
                    : place(type)
                }
                className="pressable rounded-2xl bg-paper-deep/50 p-4 text-left disabled:opacity-40"
              >
                <span className="block text-lg font-bold">{meta.label}</span>
                <span className="block text-sm font-semibold text-ink-faint">
                  {alreadyPlaced ? 'Already added' : meta.description}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
