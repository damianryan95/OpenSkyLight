import { useLayoutEffect, useRef, useState } from 'react'
import { BigButton, Dialog } from '../../components/ui'
import { ChevronDownIcon } from '../../components/icons'

/**
 * The view switcher, sized to the room the header actually has.
 *
 * On a portrait panel the header cannot hold clock, avatars, period picker,
 * seven views and the padlock in one row, and the views were what fell off the
 * edge - leaving no way back to Home. Rather than wrap or shrink, this shows as
 * many views as fit and folds the rest under "More". The current view is always
 * one of the visible ones, so a parent never has to open a menu to see where
 * they are.
 */

export interface ViewOption<T extends string> { value: T; label: string }

export interface ViewPlan<T extends string> { visible: T[]; hidden: T[] }

/**
 * Pure: which options to show, given each option's rendered width, the width
 * of the More button, and the width available. Padding is the control's own
 * inner padding. Exported so the rule can be tested without a layout engine.
 */
export function planViews<T extends string>(
  options: readonly ViewOption<T>[],
  value: T,
  widths: readonly number[],
  moreWidth: number,
  available: number,
  padding = 0
): ViewPlan<T> {
  const total = options.length
  const sum = (n: number): number => widths.slice(0, n).reduce((a, b) => a + b, 0)
  // Everything fits with no menu at all.
  if (padding + sum(total) <= available) return { visible: options.map((o) => o.value), hidden: [] }
  // Otherwise the largest N such that N buttons plus More fit; never fewer than one.
  let n = 1
  for (let candidate = total - 1; candidate >= 1; candidate -= 1) {
    if (padding + sum(candidate) + moreWidth <= available) { n = candidate; break }
  }
  const visible = options.slice(0, n).map((o) => o.value)
  if (!visible.includes(value)) {
    // The current view must be visible. It takes the last slot.
    visible[visible.length - 1] = value
  }
  const hidden = options.map((o) => o.value).filter((v) => !visible.includes(v))
  return { visible, hidden }
}

const segmentClass = (active: boolean): string =>
  `pressable min-h-12 rounded-xl px-2 text-base font-bold whitespace-nowrap transition-colors min-[1500px]:px-3 ${active ? 'bg-card text-ink shadow-card' : 'text-ink-soft'}`

interface Fit<T extends string> { plan: ViewPlan<T>; minWidth?: number; fullWidth?: number }

export function ViewSwitcher<T extends string>({
  options,
  value,
  onChange
}: {
  options: readonly ViewOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Fit<T>>({ plan: { visible: options.map((o) => o.value), hidden: [] } })
  const [moreOpen, setMoreOpen] = useState(false)

  // Flex wraps an item whose *basis* does not fit, and only then shrinks, so a
  // switcher whose basis was its full width would leave the row before it had
  // a chance to collapse. Instead the basis is the least this can be drawn at
  // (the widest single view plus More), it grows greedily up to its full width,
  // and the plan is read back from whatever width flex settles on. Both bounds
  // come from the invisible probe, never from the plan, so nothing oscillates.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const probe = probeRef.current
    if (wrap === null || probe === null) return

    const measure = (): void => {
      const items = Array.from(probe.children) as HTMLElement[]
      const widths = items.slice(0, options.length).map((b) => b.offsetWidth)
      const moreWidth = items[options.length]?.offsetWidth ?? 0
      const padding = probe.offsetWidth - widths.reduce((a, b) => a + b, 0)
      const minWidth = Math.max(...widths) + moreWidth + padding
      const fullWidth = probe.offsetWidth
      const plan = planViews(options, value, widths, moreWidth, wrap.clientWidth, padding)
      setFit((current) =>
        current.minWidth === minWidth && current.fullWidth === fullWidth && current.plan.visible.join() === plan.visible.join()
          ? current
          : { plan, minWidth, fullWidth }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [options, value])

  const { plan, minWidth, fullWidth } = fit
  const byValue = new Map(options.map((o) => [o.value, o]))
  const sizing = minWidth === undefined || fullWidth === undefined
    ? undefined
    : { flex: `999 0 ${minWidth}px`, minWidth, maxWidth: fullWidth }

  return (
    <div ref={wrapRef} className="relative flex min-w-[9rem] grow-[999] basis-[9rem] justify-end" style={sizing}>
      <div ref={probeRef} aria-hidden="true" className="pointer-events-none invisible absolute top-0 right-0 flex p-1">
        {options.map((opt) => <span key={opt.value} className={segmentClass(false)}>{opt.label}</span>)}
        {/* Out of flow so the probe's width is the options alone. */}
        <span className={`${segmentClass(false)} absolute top-1 left-1 flex items-center gap-1`}>More<ChevronDownIcon size={16} /></span>
      </div>

      <div className="flex rounded-2xl bg-paper-deep p-1">
        {plan.visible.map((v) => {
          const opt = byValue.get(v)!
          return (
            <button key={opt.value} type="button" onClick={() => onChange(opt.value)} aria-current={value === opt.value ? 'page' : undefined} className={segmentClass(value === opt.value)}>
              {opt.label}
            </button>
          )
        })}
        {plan.hidden.length > 0 && (
          <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-label="More views" className={`${segmentClass(false)} flex items-center gap-1`}>
            More<ChevronDownIcon size={16} />
          </button>
        )}
      </div>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="Go to">
        <div className="flex flex-col gap-3">
          {plan.hidden.map((v) => {
            const opt = byValue.get(v)!
            return (
              <BigButton key={opt.value} variant="ghost" onClick={() => { onChange(opt.value); setMoreOpen(false) }}>
                {opt.label}
              </BigButton>
            )
          })}
        </div>
      </Dialog>
    </div>
  )
}
