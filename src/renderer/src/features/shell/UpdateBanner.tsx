import { useEffect, useState } from 'react'
import { ipcInvoke, subscribePush } from '../../api/client'
import { XIcon } from '../../components/icons'

/** Shown when a new version has been downloaded; it installs itself at 03:30 anyway. */
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return subscribePush('push:updateReady', (data) => {
      setVersion((data as { version?: string })?.version ?? null)
      setDismissed(false)
    })
  }, [])

  if (!version || dismissed) return null
  return (
    <div className="animate-pop fixed top-4 left-1/2 z-[75] flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink py-2 pr-2 pl-5 text-paper shadow-float">
      <span className="text-base font-bold">Update v{version} is ready</span>
      <button
        type="button"
        onClick={() => void ipcInvoke('app:installUpdate', undefined)}
        className="pressable rounded-full bg-ember px-4 py-1.5 text-sm font-bold text-white"
      >
        Restart now
      </button>
      <button
        type="button"
        aria-label="Later"
        onClick={() => setDismissed(true)}
        className="pressable flex h-9 w-9 items-center justify-center rounded-full text-paper/60 hover:bg-white/10"
      >
        <XIcon size={16} />
      </button>
    </div>
  )
}
