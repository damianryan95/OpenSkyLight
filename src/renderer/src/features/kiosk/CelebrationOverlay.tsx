import { Component, type JSX, type ReactNode, useEffect, useReducer } from 'react'
import type { CelebrationEvent } from '@shared/api/contract'
import { celebrationQueueReducer, type CelebrationQueueState } from '@shared/celebration'
import { subscribePush } from '../../api/client'

const PLACEHOLDER_DURATION_MS = 1_500

const EMPTY_QUEUE: CelebrationQueueState = { active: null, pending: [] }

/**
 * Deliberately minimal host for a future full-screen celebration animation.
 * It is presentation-only: the server has already committed the chore before
 * this event is delivered, and subscriber/render failures remain local.
 */
function CelebrationOverlay(): JSX.Element | null {
  const [queue, dispatch] = useReducer(celebrationQueueReducer, EMPTY_QUEUE)

  useEffect(() => subscribePush('push:celebrationRequested', (data) => {
    // The typed SSE dispatcher only emits validated CelebrationEvent payloads.
    dispatch({ type: 'enqueue', event: data as CelebrationEvent })
  }), [])

  useEffect(() => {
    if (queue.active === null) return
    const timer = window.setTimeout(() => dispatch({ type: 'dismiss' }), PLACEHOLDER_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [queue.active?.completionId])

  if (queue.active === null) return null
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-[95] grid place-items-center bg-amber-100/15"
      data-testid="celebration-overlay-placeholder"
      onAnimationEnd={() => dispatch({ type: 'dismiss' })}
      role="status"
    >
      <span className="rounded-full bg-white/90 px-8 py-4 text-2xl font-bold text-amber-700 shadow-lg">
        Chore complete +{queue.active.stars}
      </span>
    </div>
  )
}

interface BoundaryState { failed: boolean }

/** A broken future animation is contained to this optional presentation seam. */
class CelebrationFailureBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState { return { failed: true } }

  componentDidCatch(error: unknown): void { console.warn('Celebration overlay failed', error) }

  render(): ReactNode { return this.state.failed ? null : this.props.children }
}

export function CelebrationOverlayHost(): JSX.Element {
  return <CelebrationFailureBoundary><CelebrationOverlay /></CelebrationFailureBoundary>
}
