import { useState } from 'react'
import { useAuthMutations, useAuthStatus } from '../../api/hooks'
import { IconButton } from '../../components/ui'
import { LockIcon, PlusIcon, UnlockIcon } from '../../components/icons'
import { PinDialog } from '../../components/PinDialog'
import { isDisplayClient } from '../../lib/clientMode'
import { useUi } from '../../stores/uiStore'
import { useEventEditor } from './useEventEditor'

/**
 * The visible half of `N15`.
 *
 * The server gate was already right: a locked display is refused. What was
 * missing was any way to *see* that from a calendar view, or to change it. The
 * only PIN entry point on the whole kiosk was the Home tab's pencil, labelled
 * "Customize home screen" — not where a parent looking at Tuesday goes to add
 * the dentist. So they saw nothing, and concluded the feature was not there.
 *
 * Two pieces, both driven by the same server-held unlock: a lock in the header
 * on every view, and one "Add an event" button that appears on every calendar
 * view while editing is on. Nothing here decides whether a write is allowed —
 * the server does — these only make the state legible and reachable.
 */

export function LockControl() {
  const { data: status } = useAuthStatus()
  const { verifyPin, lock } = useAuthMutations()
  const [prompt, setPrompt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!isDisplayClient()) return null
  const unlocked = status?.unlocked === true

  return (
    <>
      {unlocked ? (
        // Icon only: the header is already full on a 1280-wide panel, and a
        // worded chip pushed the view switcher off the edge. The open shackle
        // and the accent colour say "on"; the label is for screen readers.
        <IconButton label="Editing is on. Tap to lock this screen" onClick={() => lock.mutate(undefined)} className="bg-ember text-white shadow-card hover:bg-ember">
          <UnlockIcon size={24} />
        </IconButton>
      ) : (
        <IconButton label="Unlock editing with the parent PIN" onClick={() => { setError(null); setPrompt(true) }}>
          <LockIcon size={24} />
        </IconButton>
      )}
      <PinDialog
        open={prompt}
        title="Enter parent PIN"
        error={error}
        onClose={() => setPrompt(false)}
        onSubmit={(pin) =>
          verifyPin.mutate({ pin }, {
            onSuccess: (result) => {
              if (result.valid) setPrompt(false)
              else setError('Wrong PIN — try again')
            }
          })}
      />
    </>
  )
}

/** One add button for every calendar view, creating on whatever day is in
 * focus. Bottom-left, where the Home tab keeps its own pencil, so the two
 * never share a screen and a parent learns one spot. */
export function AddEventFab() {
  const { data: status } = useAuthStatus()
  const view = useUi((s) => s.view)
  const focusedDate = useUi((s) => s.focusedDate)
  const createOn = useEventEditor((s) => s.createOn)
  if (status?.unlocked !== true) return null
  if (view !== 'day' && view !== 'week' && view !== 'month' && view !== 'agenda') return null

  return (
    <button
      type="button"
      onClick={() => createOn(focusedDate)}
      aria-label="Add an event"
      className="pressable fixed bottom-7 left-7 z-30 flex min-h-14 items-center gap-2 rounded-full bg-ember px-5 text-base font-extrabold text-white shadow-float"
    >
      <PlusIcon size={20} />
      Add an event
    </button>
  )
}
