import { Component, type JSX, type ReactNode, useEffect, useMemo, useReducer, useState } from 'react'
import type { CelebrationEvent } from '@shared/api/contract'
import { celebrationQueueReducer, type CelebrationQueueState } from '@shared/celebration'
import { subscribePush } from '../../api/client'
import { fetchDisplayCelebration } from '../../api/browser'
import { usePeople } from '../../api/hooks'

const PLACEHOLDER_DURATION_MS = 1_500

const EMPTY_QUEUE: CelebrationQueueState = { active: null, pending: [], overflowCount: 0 }

/**
 * Deliberately minimal host for a future full-screen celebration animation.
 * It is presentation-only: the server has already committed the chore before
 * this event is delivered, and subscriber/render failures remain local.
 */
function CelebrationOverlay(): JSX.Element | null {
  const [queue, dispatch] = useReducer(celebrationQueueReducer, EMPTY_QUEUE)
  const people = usePeople()
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)

  useEffect(() => subscribePush('push:celebrationRequested', (data) => {
    // The typed SSE dispatcher only emits validated CelebrationEvent payloads.
    dispatch({ type: 'enqueue', event: data as CelebrationEvent })
  }), [])

  const person = queue.active === null ? undefined : people.data?.find((candidate) => candidate.id === queue.active!.personId)
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  // This value stays stable for one completion even if the people query
  // revalidates while the celebration is visible.
  const assetId = useMemo(() => queue.active === null || person === undefined ? null : person.celebrationAssetIds[Math.floor(Math.random() * person.celebrationAssetIds.length)] ?? null, [queue.active?.completionId, person?.id, person?.celebrationAssetIds])
  useEffect(() => {
    const active = queue.active
    if (active === null || reducedMotion || !person?.celebrationEnabled || assetId === null) { setMediaUrl(null); return }
    const controller = new AbortController(); let objectUrl: string | null = null
    void fetchDisplayCelebration(assetId, controller.signal).then((blob) => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setMediaUrl(objectUrl) } }).catch(() => setMediaUrl(null))
    return () => { controller.abort(); if (objectUrl !== null) URL.revokeObjectURL(objectUrl) }
  }, [queue.active?.completionId, assetId, person?.celebrationEnabled, reducedMotion])

  useEffect(() => {
    if (queue.active === null) return
    const timer = window.setTimeout(() => dispatch({ type: 'dismiss' }), person?.celebrationDurationMs ?? PLACEHOLDER_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [queue.active?.completionId, person?.celebrationDurationMs])

  if (queue.active === null) return null
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-[95] grid place-items-center bg-amber-100/15 p-8"
      data-testid="celebration-overlay"
      role="status"
    >
      <div className="celebration-card rounded-[2rem] bg-white/95 p-6 text-center shadow-2xl">
        {mediaUrl === null ? <div className="text-6xl" aria-hidden="true">⭐</div> : <img className="celebration-media mx-auto object-contain" src={mediaUrl} alt="" />}
        <span className="mt-3 block text-2xl font-bold text-amber-700">{person?.name ?? 'Great job'} earned +{queue.active.stars} stars!</span>
      </div>
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
