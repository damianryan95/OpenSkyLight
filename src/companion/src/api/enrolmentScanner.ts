import { isNativeApp } from './client'

/**
 * The only file in the companion that knows a camera exists.
 *
 * Everything above it deals in a `ScanOutcome`, so the enrolment flow is the
 * same code whether the code arrived from a camera or from a parent's thumbs —
 * which matters, because typing it is not a lesser path here. A camera can be
 * refused, broken, or simply pointed at a dark hallway, and the ceremony has to
 * survive all three.
 */

export type ScanOutcome =
  | { kind: 'scanned'; payload: string }
  /** The parent backed out of the scanner. Not an error, and not worth a message. */
  | { kind: 'cancelled' }
  /** Android refused the camera. The way on is manual entry, never a dead end. */
  | { kind: 'permission-denied' }
  /** The browser at `/admin/` — there is no camera plugin there by design. */
  | { kind: 'unavailable' }
  | { kind: 'failed' }

/** False in the browser at `/admin/`, which keeps that path free of the plugin
 * and of the 3MB web decoder it drags behind it. */
export function scannerAvailable(): boolean {
  return isNativeApp()
}

/**
 * Imported dynamically, and that is load-bearing rather than tidy. The plugin's
 * `definitions` module imports `html5-qrcode` at the top level for one enum, so
 * a static import would put the whole web decoder into the bundle the household
 * server hands to every browser at `/admin/` — a page that can never scan
 * anything. Dynamic import leaves it in a chunk only the app ever fetches.
 */
async function openScanner(): Promise<string> {
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner')
  const result = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
    scanInstructions: 'Point the camera at the square code on your screen',
    cancelButtonAccessibilityLabel: 'Stop scanning',
    torchButtonOnAccessibilityLabel: 'Turn the light off',
    torchButtonOffAccessibilityLabel: 'Turn the light on'
  })
  return result.ScanResult ?? ''
}

/**
 * Opens the system scanner and returns what it read. The payload is handed
 * straight back to the caller and never logged: it carries an enrolment code,
 * and a code in a log is a code that outlived the ceremony.
 */
export async function scanEnrolmentCode(): Promise<ScanOutcome> {
  if (!scannerAvailable()) return { kind: 'unavailable' }
  try {
    const payload = await openScanner()
    // The plugin resolves with an empty string on some cancellation paths
    // rather than rejecting, so both shapes have to mean the same thing.
    return payload === '' ? { kind: 'cancelled' } : { kind: 'scanned', payload }
  } catch (reason) {
    return classify(reason)
  }
}

/** The plugin reports cancellation and a refused camera as thrown errors with
 * nothing machine-readable on them, so the message is all there is to go on.
 * Each outcome needs a different thing said to the parent, so guessing wrong is
 * worse than the string matching looks. */
function classify(reason: unknown): ScanOutcome {
  const text = (reason instanceof Error ? reason.message : String(reason)).toLowerCase()
  if (text.includes('cancel') || text.includes('dismiss') || text.includes('abort')) return { kind: 'cancelled' }
  if (text.includes('permission') || text.includes('denied') || text.includes('unauthorized')) return { kind: 'permission-denied' }
  return { kind: 'failed' }
}
