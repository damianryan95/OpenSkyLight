import { useEffect, useRef, useState } from 'react'
import { GhostButton, PrimaryButton } from './ui'

const VIEWPORT = 280
const OUTPUT = 512

export function AvatarCropDialog({ source, onCancel, onApply }: { source: string; onCancel: () => void; onApply: (dataUrl: string) => void }) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const baseScale = Math.max(VIEWPORT / size.width, VIEWPORT / size.height)
  const scale = baseScale * zoom
  const rendered = { width: size.width * scale, height: size.height * scale }
  const clamp = (next: { x: number; y: number }) => ({
    x: Math.max(-(rendered.width - VIEWPORT) / 2, Math.min((rendered.width - VIEWPORT) / 2, next.x)),
    y: Math.max(-(rendered.height - VIEWPORT) / 2, Math.min((rendered.height - VIEWPORT) / 2, next.y))
  })
  useEffect(() => setOffset((current) => clamp(current)), [zoom, size.width, size.height])

  const apply = () => {
    const image = imageRef.current; if (!image) return
    const left = (VIEWPORT - rendered.width) / 2 + offset.x; const top = (VIEWPORT - rendered.height) / 2 + offset.y
    const canvas = document.createElement('canvas'); canvas.width = OUTPUT; canvas.height = OUTPUT
    const context = canvas.getContext('2d'); if (!context) return
    context.drawImage(image, -left / scale, -top / scale, VIEWPORT / scale, VIEWPORT / scale, 0, 0, OUTPUT, OUTPUT)
    onApply(canvas.toDataURL('image/jpeg', 0.88))
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="Crop avatar">
    <div className="w-full max-w-sm rounded-card bg-card p-4 shadow-float"><h3 className="font-display text-2xl font-semibold">Position your photo</h3><p className="mt-1 text-sm font-semibold text-ink-soft">Drag to reposition. Use the slider to zoom; everything inside the circle becomes the avatar.</p>
      <div className="relative mx-auto mt-4 overflow-hidden bg-ink" style={{ width: VIEWPORT, height: VIEWPORT, touchAction: 'none' }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y } }} onPointerMove={(event) => { const start = drag.current; if (!start || start.pointerId !== event.pointerId) return; setOffset(clamp({ x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y })) }} onPointerUp={() => { drag.current = null }}>
        <img ref={imageRef} src={source} alt="Avatar crop preview" draggable={false} onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} className="pointer-events-none absolute max-w-none select-none" style={{ width: rendered.width, height: rendered.height, left: (VIEWPORT - rendered.width) / 2 + offset.x, top: (VIEWPORT - rendered.height) / 2 + offset.y }} />
        <div className="pointer-events-none absolute inset-0 rounded-full border-4 border-white shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
      </div>
      <label className="mt-4 block text-sm font-extrabold">Zoom<input aria-label="Avatar zoom" className="mt-2 w-full accent-ember" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      <div className="mt-4 flex gap-2"><PrimaryButton onClick={apply}>Use photo</PrimaryButton><GhostButton onClick={onCancel}>Cancel</GhostButton></div>
    </div>
  </div>
}
