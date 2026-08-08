import { memo, useMemo, useRef, useState } from 'react'
import type { HomeTile } from '@shared/types'
import { sanitizeLayout } from '@shared/home'
import { useAuthMutations, useAuthStatus, useSettings, useSettingsMutation } from '../../api/hooks'
import { useUi } from '../../stores/uiStore'
import { BigButton } from '../../components/ui'
import { PinDialog } from '../../components/PinDialog'
import { GripIcon, PencilIcon, PlusIcon, XIcon } from '../../components/icons'
import { TILE_REGISTRY } from './tileRegistry'
import { useHomeGrid } from './useHomeGrid'
import { AddTileSheet } from './AddTileSheet'

// memo matters: during a drag, HomeView re-renders at pointer-event rate and
// tile bodies (with their data hooks) must not re-execute for every move
const TileBody = memo(function TileBody({ tile, compact }: { tile: HomeTile; compact: boolean }) {
  const Component = TILE_REGISTRY[tile.type].component
  return <Component tile={tile} compact={compact} />
})

export function HomeView() {
  const { data: settings } = useSettings()
  const layout = useMemo(() => sanitizeLayout(settings?.homeLayout), [settings?.homeLayout])
  const [draft, setDraft] = useState<HomeTile[] | null>(null)
  const [pinPrompt, setPinPrompt] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const editing = draft !== null
  const effective = draft ?? layout

  const { data: auth } = useAuthStatus()
  const authMutations = useAuthMutations()
  const mutation = useSettingsMutation()
  const setView = useUi((s) => s.setView)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const grid = useHomeGrid({
    containerRef,
    layout: effective,
    enabled: editing,
    onChange: (next) => setDraft(next)
  })

  const enterEdit = (): void => {
    // never edit before auth (fail-open) or settings (the draft would seed from
    // the DEFAULT layout and Done would overwrite the family's real layout)
    if (!auth || !settings) return
    if (auth.pinSet && !auth.unlocked) {
      setPinError(null)
      setPinPrompt(true)
    } else {
      setDraft(layout.map((t) => ({ ...t })))
    }
  }

  const relock = (): void => {
    if (auth?.pinSet) authMutations.lock.mutate(undefined)
  }

  const save = (): void => {
    mutation.mutate(
      { homeLayout: draft! },
      {
        onSuccess: () => {
          setDraft(null)
          relock()
        }
      }
    )
  }

  const cancel = (): void => {
    setDraft(null)
    relock()
  }

  return (
    <div className="relative flex h-full flex-col px-6 pb-6">
      {/* in edit mode the grid shrinks to keep the bottom row clear of the floating chrome bar */}
      <div ref={containerRef} className={`relative min-h-0 flex-1 ${editing ? 'mb-24' : ''}`} data-home-grid>
        {/* nothing renders until settings load (the fallback default layout must
            never be mistaken for the user's) and the grid is measured */}
        {settings != null &&
          grid.ready &&
          effective.map((tile) => {
          const compact = tile.w * grid.cellW < 260 || tile.h * grid.cellH < 170
          const isActive = grid.activeTileId === tile.id
          if (!editing) {
            const navTarget = TILE_REGISTRY[tile.type].navTarget
            // Chore boards contain their own completion buttons, so they must
            // not be nested in the generic navigation button.
            if (tile.type === 'choresProgress' || tile.type === 'familyChores' || tile.type === 'familyRewards') return <div key={tile.id} data-tile-id={tile.id} data-tile-type={tile.type} style={grid.tileStyle(tile)} className="animate-rise rounded-card bg-card p-4 shadow-card overflow-hidden"><TileBody tile={tile} compact={compact} /></div>
            return (
              <button
                key={tile.id}
                type="button"
                data-tile-id={tile.id}
                data-tile-type={tile.type}
                style={grid.tileStyle(tile)}
                onClick={() => navTarget && setView(navTarget)}
                className={`animate-rise rounded-card bg-card p-4 text-left shadow-card ${navTarget ? 'pressable' : 'cursor-default'} overflow-hidden`}
              >
                <TileBody tile={tile} compact={compact} />
              </button>
            )
          }
          return (
            <div
              key={tile.id}
              data-tile-id={tile.id}
              data-tile-type={tile.type}
              style={{ ...grid.tileStyle(tile), touchAction: 'none' }}
              {...grid.tileHandlers(tile.id)}
              className={`rounded-card bg-card p-4 shadow-card select-none ${
                isActive ? 'ring-4 ring-ember' : 'ring-2 ring-ember/50'
              } overflow-hidden`}
            >
              <TileBody tile={tile} compact={compact} />
              {/* remove */}
              <button
                type="button"
                aria-label={`Remove ${TILE_REGISTRY[tile.type].label}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setDraft(effective.filter((t) => t.id !== tile.id))}
                className="pressable absolute top-1.5 right-1.5 flex h-12 w-12 items-center justify-center rounded-full bg-ink/80 text-paper"
              >
                <XIcon size={18} />
              </button>
              {/* resize grip */}
              <div
                data-resize-handle
                {...grid.resizeHandlers(tile.id)}
                style={{ touchAction: 'none' }}
                className="absolute right-0 bottom-0 flex h-14 w-14 cursor-nwse-resize items-end justify-end p-2 text-ink-faint"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-deep">
                  <GripIcon size={18} />
                </span>
              </div>
            </div>
          )
        })}

        {grid.ghost && (
          <div
            className={`pointer-events-none absolute z-10 rounded-card border-[3px] border-dashed ${
              grid.ghost.valid ? 'border-ember bg-ember/15' : 'border-ember-deep/60 bg-ember-deep/10'
            }`}
            style={{ left: grid.ghost.left, top: grid.ghost.top, width: grid.ghost.width, height: grid.ghost.height }}
          />
        )}

        {settings && effective.length === 0 && !editing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="font-display text-3xl text-ink-faint">Your home screen is empty</div>
            <BigButton onClick={enterEdit}>Customize</BigButton>
          </div>
        )}
      </div>

      {!editing ? (
        <button
          type="button"
          aria-label="Customize home screen"
          onClick={enterEdit}
          className="pressable fixed bottom-7 left-7 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-card text-ink-soft shadow-float"
        >
          <PencilIcon size={22} />
        </button>
      ) : editing ? (
        <div className="fixed inset-x-0 bottom-5 z-30 flex justify-center">
          <div className="flex items-center gap-3 rounded-full bg-ink/90 p-2 shadow-float backdrop-blur-sm">
            <BigButton variant="ghost" onClick={() => setAddOpen(true)}>
              <span className="flex items-center gap-2">
                <PlusIcon size={18} /> Add tile
              </span>
            </BigButton>
            <BigButton variant="ghost" onClick={cancel}>
              Cancel
            </BigButton>
            <BigButton onClick={save} className="min-w-32">
              Done
            </BigButton>
          </div>
        </div>
      ) : null}

      <AddTileSheet
        open={addOpen}
        layout={effective}
        onClose={() => setAddOpen(false)}
        onAdd={(tile) => setDraft([...effective, tile])}
      />

      <PinDialog
        open={pinPrompt}
        title="Enter parent PIN"
        error={pinError}
        onClose={() => setPinPrompt(false)}
        onSubmit={(pin) =>
          authMutations.verifyPin.mutate(
            { pin },
            {
              onSuccess: (res) => {
                if (res.valid) {
                  setPinPrompt(false)
                  setDraft(layout.map((t) => ({ ...t })))
                } else {
                  setPinError('Wrong PIN — try again')
                }
              }
            }
          )
        }
      />
    </div>
  )
}
