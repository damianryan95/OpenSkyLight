import { usePeople, useSettings } from '../../api/hooks'
import { EventEditor } from './EventEditor'
import { useEventEditor } from './useEventEditor'
import { useWeekStartsOn } from './useCalendarData'

/**
 * Mounts the event editor once for the whole app (`N15`).
 *
 * Nothing here checks the PIN unlock, and that is deliberate: the *entry points*
 * are hidden while the display is locked, and the server refuses the write
 * regardless. Gating twice in the UI would leave two places to get wrong, and the
 * server's refusal is the one that actually protects the household.
 */
export function EventEditorHost() {
  const open = useEventEditor((state) => state.open)
  const occurrence = useEventEditor((state) => state.occurrence)
  const date = useEventEditor((state) => state.date)
  const close = useEventEditor((state) => state.close)
  const { data: people = [] } = usePeople()
  const { data: settings } = useSettings()
  const weekStartsOn = useWeekStartsOn()

  if (!open) return null
  return (
    <EventEditor
      target={{ occurrence, date }}
      people={people}
      weekStartsOn={weekStartsOn}
      timeFormat={settings?.timeFormat ?? '12h'}
      onClose={close}
    />
  )
}
