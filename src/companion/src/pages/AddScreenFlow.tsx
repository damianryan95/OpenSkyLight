import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  connectToHousehold,
  enrolDisplay,
  getApiBaseUrl,
  getParentCredential,
  isNativeApp,
  probeHousehold,
  type ParentAuthStatus
} from '../api/client'
import {
  decideEnrolmentStep,
  explainEnrolmentFailure,
  normaliseEnrolmentCode,
  parseEnrolmentQr,
  type EnrolmentScan,
  type HouseholdState
} from '../api/enrolment'
import { scanEnrolmentCode, scannerAvailable } from '../api/enrolmentScanner'
import { Card } from '../components/ui'

/** The browser at `/admin/` is always paired: it is served by the household
 * server and carries its session. Only the installed app can be looking at a
 * screen belonging to a household it has never met. */
function phoneIsPaired(): boolean {
  return !isNativeApp() || (getApiBaseUrl() !== '' && getParentCredential() !== null)
}

/**
 * Adding a screen by scanning it (ADR 0006).
 *
 * The ceremony runs the way round a wall-mounted screen can actually cope
 * with: the screen shows a code, the phone reads it. Nothing secret travels
 * towards the screen, which is what `N16` recorded failing in a real kitchen —
 * an enrolment link that could not be moved onto a device with no keyboard.
 *
 * The code lives in this component's state and nowhere else. It is never
 * stored, never logged, and goes out of existence with the flow.
 *
 * Reached from two places, because the household state that decides between
 * the three cases also decides which screen a parent is looking at: a paired
 * phone finds it under Displays, an unpaired one on the connect screen.
 */

type Stage =
  | { kind: 'intro' }
  | { kind: 'manual' }
  | { kind: 'checking'; scan: EnrolmentScan }
  | { kind: 'pair'; scan: EnrolmentScan; serverAddress: string }
  | { kind: 'not-set-up'; serverAddress: string }
  | { kind: 'name'; scan: EnrolmentScan; serverAddress: string; addressMismatch: boolean }
  | { kind: 'done'; screenName: string }

export function AddScreenFlow({
  initialCode,
  onEnrolled,
  onPaired,
  onClose
}: {
  /** A code that arrived in the address bar, from a scan by the phone's own
   * camera app. It skips straight to naming the screen: the parent has already
   * done the reading, and asking them to do it again would be the insult. */
  initialCode?: string | null
  /** A screen joined the household: refresh whatever list is behind this flow. */
  onEnrolled?: () => void | Promise<void>
  /** Only supplied by the connect screen, where finishing also means this phone
   * is now paired and the app should open. */
  onPaired?: (status: ParentAuthStatus) => void
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>(() => {
    if (initialCode === null || initialCode === undefined) return { kind: 'intro' }
    if (!phoneIsPaired()) return { kind: 'manual' }
    const serverAddress = getApiBaseUrl() || window.location.origin
    return { kind: 'name', scan: { serverAddress, code: initialCode }, serverAddress, addressMismatch: false }
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Both survive a failed step on purpose: a parent who has already named the
  // screen and had the code expire under them should re-scan, not retype.
  const [screenName, setScreenName] = useState('')
  const [typedCode, setTypedCode] = useState(initialCode ?? '')
  const [typedAddress, setTypedAddress] = useState('')
  const [phoneName, setPhoneName] = useState('My phone')
  const [pin, setPin] = useState('')
  // A case-3 flow can pair this phone and still fail to redeem the code. The
  // phone is genuinely in the household at that point, so the way out has to
  // be "open the app", not "start again".
  const [justPaired, setJustPaired] = useState<ParentAuthStatus | null>(null)

  const scannerHere = scannerAvailable()
  const requests = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => () => {
    alive.current = false
    requests.current?.abort()
  }, [])

  const nextRequest = (): AbortSignal => {
    requests.current?.abort()
    const controller = new AbortController()
    requests.current = controller
    return controller.signal
  }

  /** Where the scan lands: paired phones redeem, unpaired ones find out what
   * kind of household they just met. */
  const begin = async (scan: EnrolmentScan) => {
    setError(null)
    if (phoneIsPaired()) {
      const serverAddress = getApiBaseUrl() || window.location.origin
      const state: HouseholdState = { paired: true, serverAddress }
      const step = decideEnrolmentStep(scan, state)
      if (step.kind === 'name-the-screen') {
        setStage({ kind: 'name', scan, serverAddress: step.serverAddress, addressMismatch: step.addressMismatch })
      }
      return
    }
    setStage({ kind: 'checking', scan })
    try {
      const status = await probeHousehold(scan.serverAddress, nextRequest())
      if (!alive.current) return
      const step = decideEnrolmentStep(scan, { paired: false, configured: status.configured })
      if (step.kind === 'pair-this-phone') setStage({ kind: 'pair', scan, serverAddress: step.serverAddress })
      else if (step.kind === 'household-not-set-up') setStage({ kind: 'not-set-up', serverAddress: step.serverAddress })
      else setStage({ kind: 'name', scan, serverAddress: step.serverAddress, addressMismatch: false })
    } catch (reason) {
      if (!alive.current || (reason instanceof DOMException && reason.name === 'AbortError')) return
      setStage({ kind: 'manual' })
      setTypedAddress(scan.serverAddress)
      setError(`Nothing answered at ${scan.serverAddress}. Check this phone is on the same home Wi-Fi as the screen rather than mobile data, then try again.`)
    }
  }

  const scan = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await scanEnrolmentCode()
      if (!alive.current) return
      if (outcome.kind === 'cancelled') return
      if (outcome.kind === 'permission-denied') {
        setStage({ kind: 'manual' })
        setError('This phone would not let OpenSkyLight use the camera. You can turn that on in Android settings under Apps, or just type the code shown under the square on your screen.')
        return
      }
      if (outcome.kind === 'failed' || outcome.kind === 'unavailable') {
        setStage({ kind: 'manual' })
        setError('The camera could not be opened. Type the code shown under the square on your screen instead.')
        return
      }
      const parsed = parseEnrolmentQr(outcome.payload)
      if (parsed === null) {
        setError('That is a code of some kind, but not one of ours. Make sure you are pointing at the square shown by OpenSkyLight on your screen.')
        return
      }
      await begin(parsed)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const submitManual = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const code = normaliseEnrolmentCode(typedCode)
    if (code === null) return
    const paired = phoneIsPaired()
    const address = paired ? getApiBaseUrl() || window.location.origin : typedAddress.trim()
    if (!paired && address === '') return
    setBusy(true)
    try {
      await begin({ serverAddress: address, code })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const redeem = async (scanned: EnrolmentScan) => {
    const name = screenName.trim()
    await enrolDisplay(scanned.code, name, nextRequest())
    if (!alive.current) return
    setStage({ kind: 'done', screenName: name })
    await onEnrolled?.()
  }

  const submitName = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || stage.kind !== 'name' || screenName.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await redeem(stage.scan)
    } catch (reason) {
      if (!alive.current || (reason instanceof DOMException && reason.name === 'AbortError')) return
      setError(explainEnrolmentFailure(reason, stage.serverAddress))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  /** Case 3, as one act: the PIN pairs this phone, and the code it arrived with
   * is spent immediately afterwards, so the parent answers one question rather
   * than being handed back to a connect screen that asks for an address they
   * would have to read off the wall. */
  const submitPairing = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || stage.kind !== 'pair' || screenName.trim() === '' || phoneName.trim() === '' || !/^\d{4,64}$/.test(pin)) return
    setBusy(true)
    setError(null)
    const { scan: scanned, serverAddress } = stage
    // Tracked locally rather than read back from state: the two halves run in
    // one handler, and the failure message for "the PIN was wrong" is the
    // opposite of the one for "you are in, but the code went stale".
    let paired = false
    try {
      const status = await connectToHousehold(serverAddress, pin, phoneName.trim())
      if (!alive.current) return
      paired = true
      setJustPaired(status)
      // The PIN has done its work; holding it in a form field afterwards is
      // needless exposure on a phone that may be handed to a child.
      setPin('')
      await redeem(scanned)
    } catch (reason) {
      if (!alive.current || (reason instanceof DOMException && reason.name === 'AbortError')) return
      setError(paired ? explainEnrolmentFailure(reason, serverAddress) : explainPairing(reason, serverAddress))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const finish = () => {
    if (justPaired !== null) onPaired?.(justPaired)
    onClose()
  }

  const normalised = normaliseEnrolmentCode(typedCode)
  const codeLooksWrong = normalised === null && typedCode.replace(/[^0-9A-Za-z]/g, '').length >= 8

  return (
    <Card className="mb-3 space-y-4">
      <div>
        <h3 className="font-display text-xl font-semibold">Add a screen</h3>
        <p className="mt-1 text-sm leading-5 text-ink-soft">
          Open OpenSkyLight on the screen you want to add. A screen that has not joined a household yet shows a square code — that is what this reads.
        </p>
      </div>

      {stage.kind === 'intro' && (
        <div className="space-y-3">
          {scannerHere ? (
            <>
              <p className="text-sm leading-5 text-ink-soft">
                Scanning uses this phone’s camera, and Android will ask your permission the first time. It is only used to read the code on your screen — nothing is recorded or sent anywhere.
              </p>
              <FullButton onClick={() => void scan()} disabled={busy}>{busy ? 'Opening the camera…' : 'Scan the screen’s code'}</FullButton>
              <FullGhost onClick={() => { setError(null); setStage({ kind: 'manual' }) }}>Type the code instead</FullGhost>
            </>
          ) : (
            <>
              <p className="text-sm leading-5 text-ink-soft">
                This browser cannot use a camera for this. Type the eight characters shown under the square on your screen and it will join the household just the same.
              </p>
              <FullButton onClick={() => { setError(null); setStage({ kind: 'manual' }) }}>Type the code from the screen</FullButton>
            </>
          )}
          <FullGhost onClick={onClose}>Cancel</FullGhost>
        </div>
      )}

      {stage.kind === 'manual' && (
        <form className="space-y-4" onSubmit={submitManual} noValidate>
          {!phoneIsPaired() && (
            <Field
              label="Household server address"
              help="Shown on the screen beneath the code, and it is the address of the OpenSkyLight box in your home."
            >
              <input
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                className={inputClass}
                inputMode="url"
                onChange={(event) => setTypedAddress(event.target.value)}
                placeholder="http://openskylight.local:3000"
                spellCheck={false}
                type="text"
                value={typedAddress}
              />
            </Field>
          )}
          <Field
            label="Code from the screen"
            help="Eight letters and numbers. Capitals or lower case both work, and so does a 1 where you read an I."
          >
            <input
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              className={`${inputClass} tracking-[0.2em] uppercase`}
              maxLength={20}
              onChange={(event) => setTypedCode(event.target.value)}
              placeholder="K7M2QX4A"
              spellCheck={false}
              type="text"
              value={typedCode}
            />
          </Field>
          {codeLooksWrong && <p className="text-sm font-bold text-amber-800">That is not eight characters of a screen code yet. Check it against the screen.</p>}
          {error !== null && <ErrorNote>{error}</ErrorNote>}
          <FullButton disabled={normalised === null || busy} type="submit">{busy ? 'Checking…' : 'Continue'}</FullButton>
          {scannerHere && <FullGhost onClick={() => { setError(null); setStage({ kind: 'intro' }) }}>Use the camera instead</FullGhost>}
          <FullGhost onClick={onClose}>Cancel</FullGhost>
        </form>
      )}

      {stage.kind === 'checking' && <p className="text-base font-bold text-ink-faint">Looking for your household…</p>}

      {stage.kind === 'not-set-up' && (
        <div className="space-y-3">
          <p className="text-base leading-6 text-ink-soft">
            This household has not been set up yet, so there is no PIN for this phone to prove itself with. Open <span className="font-bold break-all">{stage.serverAddress}/admin/</span> in a browser on any device, choose a household PIN there, then come back and scan the screen again.
          </p>
          <p className="text-sm leading-5 text-ink-faint">The app cannot do that first-time setup itself yet.</p>
          <FullGhost onClick={onClose}>Close</FullGhost>
        </div>
      )}

      {stage.kind === 'pair' && (
        <form className="space-y-4" onSubmit={submitPairing} noValidate>
          <p className="text-base leading-6 text-ink-soft">
            That screen belongs to the household at <span className="font-bold break-all">{stage.serverAddress}</span>, which this phone has not joined yet. Your household PIN connects it, and adds the screen at the same time.
          </p>
          <Field label="Name for this screen" help="Where it is, usually. This is how you will find it later, or cut it off if it leaves the house.">
            <input autoComplete="off" className={inputClass} maxLength={120} onChange={(event) => setScreenName(event.target.value)} placeholder="Kitchen wall" type="text" value={screenName} />
          </Field>
          <Field label="A name for this phone" help="Shown under Displays on every phone in the household, so make it one you would recognise.">
            <input autoComplete="off" className={inputClass} maxLength={120} onChange={(event) => setPhoneName(event.target.value)} type="text" value={phoneName} />
          </Field>
          <Field label="Household PIN" help="The same PIN that opens household settings in a browser. Digits only, 4 to 64 characters.">
            <input
              autoComplete="current-password"
              className={`${inputClass} tracking-[0.35em]`}
              inputMode="numeric"
              maxLength={64}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              pattern="[0-9]*"
              type="password"
              value={pin}
            />
          </Field>
          {error !== null && <ErrorNote>{error}</ErrorNote>}
          {justPaired !== null
            ? <FullButton onClick={finish}>Open the household</FullButton>
            : <FullButton disabled={busy || screenName.trim() === '' || phoneName.trim() === '' || !/^\d{4,64}$/.test(pin)} type="submit">{busy ? 'Connecting…' : 'Connect and add the screen'}</FullButton>}
          <FullGhost onClick={onClose}>Cancel</FullGhost>
        </form>
      )}

      {stage.kind === 'name' && (
        <form className="space-y-4" onSubmit={submitName} noValidate>
          {stage.addressMismatch && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
              That screen says its household is at {stage.scan.serverAddress}, and this phone uses {stage.serverAddress}. If that is the same box under another name, carry on. If it is not, the code will simply be refused.
            </p>
          )}
          <Field label="Name for this screen" help="Where it is, usually. This is how you will find it later, or cut it off if it leaves the house.">
            <input autoComplete="off" autoFocus className={inputClass} maxLength={120} onChange={(event) => setScreenName(event.target.value)} placeholder="Kitchen wall" type="text" value={screenName} />
          </Field>
          {error !== null && <ErrorNote>{error}</ErrorNote>}
          <FullButton disabled={busy || screenName.trim() === ''} type="submit">{busy ? 'Adding the screen…' : 'Add this screen'}</FullButton>
          {error !== null && scannerHere && <FullGhost onClick={() => void scan()}>Read the new code</FullGhost>}
          {error !== null && <FullGhost onClick={() => { setError(null); setTypedCode(''); setStage({ kind: 'manual' }) }}>Type the new code</FullGhost>}
          <FullGhost onClick={onClose}>Cancel</FullGhost>
        </form>
      )}

      {stage.kind === 'done' && (
        <div className="space-y-3">
          <p className="text-base leading-6 font-bold text-green-900">{stage.screenName} has joined the household.</p>
          <p className="text-sm leading-5 text-ink-soft">Look at the screen. It should stop showing the code and start showing your household within a few seconds.</p>
          <FullButton onClick={finish}>Done</FullButton>
        </div>
      )}
    </Card>
  )
}

/** A failed pairing has a different thing to do about it than a failed
 * redemption, and this flow can produce either. */
function explainPairing(reason: unknown, serverAddress: string): string {
  const status = (reason as { status?: unknown }).status
  if (status === 401) return 'That household PIN was not accepted. Check the PIN you use to open household settings in a browser, then try again.'
  if (status === 429) return 'Too many attempts have been made. Wait a minute, then try again.'
  if (status === 409) return `This household has not been set up yet. Open ${serverAddress}/admin/ in a browser, choose a household PIN there, then scan the screen again.`
  if (typeof status === 'number') return `That household refused the connection (${status}). Check the screen is still showing a code, then try again.`
  return `Nothing answered at ${serverAddress}. Check this phone is on the same home Wi-Fi as the screen rather than mobile data, then try again.`
}

/** Thumb-sized and full width: this flow is run one-handed, standing in front
 * of the screen being added. */
const inputClass = 'min-h-14 w-full rounded-xl border border-line bg-paper px-4 text-base font-semibold outline-none focus:border-ember'

function FullButton({ children, onClick, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} onClick={onClick} disabled={disabled} className="pressable min-h-12 w-full rounded-xl bg-ember px-4 text-base font-extrabold text-white disabled:opacity-40">{children}</button>
}

function FullGhost({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="pressable min-h-12 w-full rounded-xl bg-paper-deep px-4 text-base font-extrabold text-ink-soft">{children}</button>
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-extrabold text-ink-soft">{label}</span>{children}<span className="mt-2 block text-sm font-semibold text-ink-faint">{help}</span></label>
}

function ErrorNote({ children }: { children: string }) {
  return <p className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">{children}</p>
}
