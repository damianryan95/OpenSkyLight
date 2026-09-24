import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'

/**
 * Renders a QR as a data URL.  Generation is local (the `qrcode` package is
 * bundled at build time), so nothing here needs a credential and there is no
 * object URL to revoke — a data URL is a plain string.
 *
 * If generation ever fails the panel stays quiet and the caller's typed code
 * carries the ceremony, rather than the screen showing a broken image.
 */
export function QrCode({ payload, label }: { payload: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    toDataURL(payload, {
      errorCorrectionLevel: 'M',
      // Four light modules of quiet zone, per the QR spec, so a phone camera
      // locks on even when the panel bezel crowds the code.
      margin: 4,
      // Generated well above the rendered size: a wall panel may be 2400px wide
      // and a soft QR is a QR that does not scan.
      width: 960,
      color: { dark: '#221e18', light: '#ffffff' }
    })
      .then((url) => { if (!cancelled) setSrc(url) })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => { cancelled = true }
  }, [payload])

  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-3xl bg-white p-3 shadow-card">
      {src === null
        ? <div className="h-full w-full rounded-2xl bg-[#f1ece2]" aria-hidden="true" />
        : <img src={src} alt={label} className="h-full w-full" draggable={false} />}
    </div>
  )
}
