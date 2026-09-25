import { useState, type FormEvent } from 'react'
import { ApiError, connectToHousehold, getApiBaseUrl, probeHousehold, type ParentAuthStatus } from '../api/client'
import type { EnrolmentScan } from '../api/enrolment'
import { Card, PrimaryButton } from '../components/ui'
import { AddScreenFlow } from './AddScreenFlow'
import { HouseholdSetupFlow } from './HouseholdSetupFlow'
import { scannerAvailable } from '../api/enrolmentScanner'

const DEFAULT_ADDRESS = 'http://openskylight.local:3000'

/**
 * The installed app's way in. It exists only in the native shell: a browser at
 * `/admin/` is already served by the household server and already has a
 * session, so it never reaches this screen.
 *
 * Three things have to be true before the app can do anything, and each is a
 * different kind of wrong when it is not — the address is a networking mistake,
 * the PIN is a memory one. They are asked together, and reported apart.
 */
export function PairingScreen({ onPaired }: { onPaired: (status: ParentAuthStatus) => void }) {
  // A phone that was revoked, or that pointed at a bad address, comes back here
  // with its last address still known. Re-offering it beats retyping it.
  const [address, setAddress] = useState(() => getApiBaseUrl() || DEFAULT_ADDRESS)
  const [name, setName] = useState('My phone')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The second parent's phone has no reason to know the household's address, and
  // asking them to read one off a wall is the failure ADR 0006 exists to remove.
  // Scanning a screen supplies the address and adds that screen in one go.
  const [scanning, setScanning] = useState(false)
  // Case 1 of ADR 0006: the household this phone has just met has no PIN yet.
  // Whether it arrived by scan (with a screen to add) or by a typed address
  // (without), the same first-run flow takes over from here.
  const [setup, setSetup] = useState<{ serverAddress: string; scan: EnrolmentScan | null } | null>(null)
  const isValid = address.trim().length > 0 && name.trim().length > 0 && /^\d{4,64}$/.test(pin)

  /** Asks the box whether anyone has set it up. A brand-new one has no PIN to
   * connect with, so the parent is offered to create one rather than told to
   * find a browser. */
  const startSetup = async () => {
    if (busy || address.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const status = await probeHousehold(address)
      if (status.configured) {
        setError('That OpenSkyLight is already set up. Connect to it with its household PIN below instead.')
        return
      }
      setSetup({ serverAddress: address.trim(), scan: null })
    } catch {
      setError(`Nothing answered at ${address.trim()}. Check the address, and check this phone is on the same home Wi-Fi as the OpenSkyLight box rather than mobile data.`)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isValid || busy) return
    setBusy(true)
    setError(null)
    try {
      // A PIN typed against a household that has none cannot be checked — but it
      // must not silently become the household's PIN either. Send the parent
      // through setup, where they choose one deliberately and confirm it.
      const status = await probeHousehold(address)
      if (!status.configured) {
        setSetup({ serverAddress: address.trim(), scan: null })
        return
      }
      onPaired(await connectToHousehold(address, pin, name.trim()))
    } catch (reason) {
      // What was typed stays in the form: a failed attempt should cost a retap,
      // not a retype. Only the stored pairing is unwound, inside the client.
      setError(explain(reason, address))
    } finally {
      setBusy(false)
    }
  }

  if (setup !== null) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md items-center p-5" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        <HouseholdSetupFlow
          serverAddress={setup.serverAddress}
          scan={setup.scan}
          initialPhoneName={name}
          onComplete={onPaired}
          onCancel={() => { setSetup(null); setScanning(false) }}
        />
      </main>
    )
  }

  if (scanning) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md items-center p-5" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        <div className="w-full">
          <AddScreenFlow
            onPaired={onPaired}
            onClaimHousehold={(serverAddress, scan) => setSetup({ serverAddress, scan })}
            onClose={() => setScanning(false)}
          />
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md items-center p-5" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
      <Card className="w-full p-6">
        <p className="text-xs font-extrabold tracking-[0.18em] text-ember uppercase">OpenSkyLight</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Connect this phone</h1>
        <p className="mt-3 text-base leading-6 text-ink-soft">
          This app talks to the OpenSkyLight box in your own home. It needs to know where that box is, and your household PIN to prove you are allowed in.
        </p>

        {scannerAvailable() && (
          <div className="mt-5 rounded-xl bg-paper-deep p-4">
            <p className="text-base leading-6 font-bold">Standing in front of a screen?</p>
            <p className="mt-1 text-sm leading-5 text-ink-soft">
              If a screen in your home is showing a square OpenSkyLight code, scanning it tells this phone where the box is — so you only need the household PIN, not the address.
            </p>
            <button type="button" className="pressable mt-3 min-h-12 w-full rounded-xl bg-ember px-4 text-base font-extrabold text-white" onClick={() => setScanning(true)}>
              Scan a screen instead
            </button>
          </div>
        )}

        <div className="mt-5 rounded-xl bg-paper-deep p-4">
          <p className="text-base leading-6 font-bold">Setting up a new OpenSkyLight?</p>
          <p className="mt-1 text-sm leading-5 text-ink-soft">
            If nobody has set up the box yet, there is no PIN to connect with. Enter its address below, then this phone will create the household — no browser needed.
          </p>
          <button type="button" className="pressable mt-3 min-h-12 w-full rounded-xl bg-paper px-4 text-base font-extrabold text-ink-soft" onClick={() => void startSetup()} disabled={busy || address.trim() === ''}>
            Set up a new household
          </button>
        </div>

        <form className="mt-6 space-y-5" onSubmit={submit} noValidate>
          <label className="block">
            <span className="mb-2 block text-sm font-extrabold text-ink-soft">Household server address</span>
            <input
              aria-describedby="address-help"
              autoCapitalize="none"
              autoComplete="url"
              autoCorrect="off"
              className="min-h-14 w-full rounded-xl border border-line bg-paper px-4 text-base font-semibold outline-none focus:border-ember"
              inputMode="url"
              onChange={(event) => setAddress(event.target.value)}
              spellCheck={false}
              type="text"
              value={address}
            />
            <span id="address-help" className="mt-2 block text-sm font-semibold text-ink-faint">
              The address of the box running OpenSkyLight at home. A numeric address like http://192.168.1.50:3000 works too.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-extrabold text-ink-soft">A name for this phone</span>
            <input
              aria-describedby="name-help"
              autoComplete="off"
              className="min-h-14 w-full rounded-xl border border-line bg-paper px-4 text-base font-semibold outline-none focus:border-ember"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              type="text"
              value={name}
            />
            <span id="name-help" className="mt-2 block text-sm font-semibold text-ink-faint">
              Shown under Displays on every phone in the household, so make it one you would recognise if you ever had to cut this phone off.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-extrabold text-ink-soft">Household PIN</span>
            <input
              aria-describedby={error === null ? 'pairing-pin-help' : 'pairing-error'}
              aria-invalid={error === null ? undefined : true}
              autoComplete="current-password"
              className="min-h-14 w-full rounded-xl border border-line bg-paper px-4 text-xl font-bold tracking-[0.35em] outline-none focus:border-ember"
              inputMode="numeric"
              maxLength={64}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              pattern="[0-9]*"
              type="password"
              value={pin}
            />
            <span id="pairing-pin-help" className="mt-2 block text-sm font-semibold text-ink-faint">
              The same PIN you use to open household settings in a browser. Digits only, 4 to 64 characters.
            </span>
          </label>

          {error !== null && <p id="pairing-error" className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">{error}</p>}
          <PrimaryButton type="submit" disabled={!isValid || busy}>{busy ? 'Connecting…' : 'Connect this phone'}</PrimaryButton>
        </form>
      </Card>
    </main>
  )
}

/** Each failure needs a different thing done about it, so each gets its own
 * sentence. A single "Pairing failed" would leave a parent with nothing to
 * try next, which is the state this whole screen exists to avoid. */
function explain(reason: unknown, address: string): string {
  if (!(reason instanceof ApiError)) {
    return `Nothing answered at ${address.trim()}. Check the address, and check this phone is on the same home Wi-Fi as the OpenSkyLight box rather than mobile data.`
  }
  if (reason.status === 401) {
    return 'That household PIN was not accepted. Check the PIN you use to open household settings in a browser, then try again.'
  }
  if (reason.status === 429) {
    return reason.retryAfterSeconds === undefined
      ? 'Too many attempts have been made. Wait a minute, then try again.'
      : `Too many attempts have been made. Wait ${reason.retryAfterSeconds} seconds, then try again.`
  }
  // The probe above should have caught this, so reaching here means the
  // household lost its PIN between the two requests — which does not happen.
  // Say the useful thing anyway rather than something about browsers.
  if (reason.status === 409) {
    return 'This household has not been set up yet, so there is no PIN to connect with. Choose Set up a new household above.'
  }
  if (reason.status === 404) {
    return `Something answered at ${address.trim()}, but it does not offer phone pairing. Either that is not the OpenSkyLight server, or the server is running an older version than this app.`
  }
  // The server writes its errors for a parent to read, so show what it said
  // rather than replacing it with a guess. The code is included because
  // without it a failure here cannot be diagnosed from a photo of the screen.
  return `That address answered, but refused the connection (${reason.status}): ${reason.message}`
}
