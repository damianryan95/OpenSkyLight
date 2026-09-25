import { useState, type FormEvent, type ReactNode } from 'react'
import type { PersonDto } from '@shared/types'
import { ApiError, claimHousehold, enrolDisplay, parentGet, parentMutation, type ParentAuthStatus } from '../api/client'
import type { EnrolmentScan } from '../api/enrolment'
import { Card, GhostButton, PersonAvatar, PrimaryButton, TextInput } from '../components/ui'
import { LocationPicker, emptyLocation, locationToSettings, type LocationValue } from '../components/LocationPicker'
import { AddScreenFlow } from './AddScreenFlow'
import { PERSON_COLOURS } from './PeopleCalendarsPage'

/**
 * First-run setup, on the phone (`N04`), for a household nobody has set up.
 *
 * Entered two ways and identical after the first step: by scanning a brand-new
 * screen's code (ADR 0006 case 1, which also adds that screen), or by typing
 * the box's address and finding it has no PIN yet. Either way the parent never
 * opens a browser, which is the whole point.
 *
 * Every step here is a thin front on a page that already exists — Household,
 * the Home tab's location card, Displays — so nothing set up here is set up in
 * a way that cannot be changed later from the ordinary place.
 *
 * The flow is never offered to a configured household. That is a property of
 * server state (`/auth/status` says `configured`), not of a flag kept here, so
 * adding a fourth screen a year later cannot re-run it.
 */

type Step = 'claim' | 'where' | 'people' | 'screen' | 'done'
const STEPS: Step[] = ['claim', 'where', 'people', 'screen']

export function HouseholdSetupFlow({
  serverAddress,
  scan = null,
  initialPhoneName = 'My phone',
  onComplete,
  onCancel
}: {
  serverAddress: string
  /** The screen whose code brought us here, when there was one. Redeemed the
   * moment the household is claimed, so the parent is never handed back to a
   * connect screen holding a code they would have to read off the wall again. */
  scan?: EnrolmentScan | null
  initialPhoneName?: string
  onComplete: (status: ParentAuthStatus) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>('claim')
  const [status, setStatus] = useState<ParentAuthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1.
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [phoneName, setPhoneName] = useState(initialPhoneName)
  const [screenName, setScreenName] = useState('Kitchen wall')
  // The screen may fail to redeem after the claim succeeds — its code expired
  // while the parent typed. The phone is genuinely in the household at that
  // point, so the flow carries on and offers the screen again at the end.
  const [screenAdded, setScreenAdded] = useState<string | null>(null)
  const [screenNote, setScreenNote] = useState<string | null>(null)

  // Step 2.
  const [location, setLocation] = useState<LocationValue>(() => emptyLocation())

  // Step 3.
  const [people, setPeople] = useState<PersonDto[]>([])
  const [personName, setPersonName] = useState('')
  const [personRole, setPersonRole] = useState<'parent' | 'child'>('child')
  const [personColour, setPersonColour] = useState<string>(PERSON_COLOURS[0])

  const pinValid = /^\d{4,64}$/.test(pin)
  const pinsMatch = pin === confirm
  const canClaim = pinValid && pinsMatch && phoneName.trim() !== '' && (scan === null || screenName.trim() !== '') && !busy

  const submitClaim = async (event: FormEvent) => {
    event.preventDefault()
    if (!canClaim) return
    setBusy(true)
    setError(null)
    try {
      const claimed = await claimHousehold(serverAddress, pin, phoneName.trim())
      setStatus(claimed)
      // The PIN has done its work. Holding it in a form afterwards is needless
      // exposure on a phone that may be handed to a child a minute from now.
      setPin('')
      setConfirm('')
      if (scan !== null) {
        try {
          await enrolDisplay(scan.code, screenName.trim())
          setScreenAdded(screenName.trim())
        } catch {
          setScreenNote('The screen’s code had expired by the time the household was ready. You are in — the screen can be added at the end.')
        }
      }
      setStep('where')
    } catch (reason) {
      setError(explainClaim(reason, serverAddress))
    } finally {
      setBusy(false)
    }
  }

  const submitWhere = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = locationToSettings(location)
    if (!parsed.ok) { setError(parsed.message); return }
    setBusy(true)
    setError(null)
    try {
      await parentMutation('/api/v1/household/settings', 'PATCH', parsed.settings)
      setStep('people')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Could not save where you live. Check this phone is still on the home Wi-Fi, then try again.')
    } finally {
      setBusy(false)
    }
  }

  const addPerson = async (event: FormEvent) => {
    event.preventDefault()
    if (personName.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await parentMutation('/api/v1/people', 'POST', { name: personName.trim(), color: personColour, role: personRole })
      setPeople((await parentGet<{ people: PersonDto[] }>('/api/v1/people')).people)
      setPersonName('')
      // Rotate the colour so siblings added in a row do not all come out the same.
      setPersonColour(PERSON_COLOURS[(PERSON_COLOURS.indexOf(personColour as typeof PERSON_COLOURS[number]) + 1) % PERSON_COLOURS.length]!)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Could not add that person. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const finish = () => { if (status !== null) onComplete(status) }

  const index = STEPS.indexOf(step)

  return (
    <Card className="w-full p-6">
      <p className="text-xs font-extrabold tracking-[0.18em] text-ember uppercase">OpenSkyLight</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Set up your household</h1>
      {index >= 0 && <p className="mt-1 text-sm font-extrabold text-ink-faint">Step {index + 1} of {STEPS.length}</p>}

      {step === 'claim' && (
        <form className="mt-5 space-y-5" onSubmit={submitClaim} noValidate>
          <p className="text-base leading-6 text-ink-soft">
            Nobody has set up the OpenSkyLight at <span className="font-bold break-all">{serverAddress}</span> yet. Choose the household PIN — it is what any parent will use to make changes, from this phone or the wall.
          </p>
          <Field label="Household PIN" help="Digits only, 4 to 64 of them. Something the children will not guess.">
            <input autoComplete="new-password" autoFocus className={`${inputClass} tracking-[0.35em]`} inputMode="numeric" maxLength={64} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} pattern="[0-9]*" type="password" value={pin} />
          </Field>
          <Field label="Type the PIN again" help={confirm !== '' && !pinsMatch ? 'These do not match yet.' : 'So a slip of the thumb does not lock you out of your own household.'}>
            <input autoComplete="new-password" className={`${inputClass} tracking-[0.35em]`} inputMode="numeric" maxLength={64} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))} pattern="[0-9]*" type="password" value={confirm} aria-invalid={confirm !== '' && !pinsMatch ? true : undefined} />
          </Field>
          <Field label="A name for this phone" help="Shown under Displays on every phone in the household, so make it one you would recognise.">
            <input autoComplete="off" className={inputClass} maxLength={120} onChange={(event) => setPhoneName(event.target.value)} type="text" value={phoneName} />
          </Field>
          {scan !== null && (
            <Field label="Name for the screen you scanned" help="Where it is, usually. It joins the household the moment the PIN is set.">
              <input autoComplete="off" className={inputClass} maxLength={120} onChange={(event) => setScreenName(event.target.value)} type="text" value={screenName} />
            </Field>
          )}
          {error !== null && <ErrorNote>{error}</ErrorNote>}
          <PrimaryButton type="submit" disabled={!canClaim}>{busy ? 'Setting up…' : 'Create the household'}</PrimaryButton>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </form>
      )}

      {step === 'where' && (
        <form className="mt-5 space-y-4" onSubmit={submitWhere} noValidate>
          {screenNote !== null && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{screenNote}</p>}
          <p className="text-base leading-6 text-ink-soft">
            Where does this household live? The time zone decides which day a chore belongs to on every screen. A town lets the screens show the weather.
          </p>
          <LocationPicker value={location} onChange={(next) => { setLocation(next); setError(null) }} />
          {error !== null && <ErrorNote>{error}</ErrorNote>}
          <PrimaryButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</PrimaryButton>
        </form>
      )}

      {step === 'people' && (
        <div className="mt-5 space-y-4">
          <p className="text-base leading-6 text-ink-soft">
            Who lives here? Each person gets their own colour on the calendar, and children get chores and stars. You can add more, or change anything, under Household later.
          </p>
          {people.length > 0 && (
            <ul className="space-y-2" aria-label="People added">
              {people.map((person) => (
                <li key={person.id} className="flex items-center gap-3 rounded-xl bg-paper-deep px-3 py-2">
                  <PersonAvatar name={person.name} color={person.color} avatarUrl={person.avatarUrl} />
                  <span className="min-w-0 flex-1 truncate font-bold">{person.name}</span>
                  <span className="text-sm font-semibold text-ink-faint">{person.role === 'child' ? 'Child' : 'Parent'}</span>
                </li>
              ))}
            </ul>
          )}
          <form className="space-y-3 rounded-xl border border-line p-3" onSubmit={addPerson} noValidate>
            <TextInput value={personName} onChange={setPersonName} placeholder="Name" autoFocus={people.length === 0} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={personRole === 'child'} onClick={() => setPersonRole('child')} className={`min-h-11 rounded-xl border-2 font-extrabold ${personRole === 'child' ? 'border-ember bg-ember/10' : 'border-line bg-paper'}`}>Child</button>
              <button type="button" aria-pressed={personRole === 'parent'} onClick={() => setPersonRole('parent')} className={`min-h-11 rounded-xl border-2 font-extrabold ${personRole === 'parent' ? 'border-ember bg-ember/10' : 'border-line bg-paper'}`}>Parent</button>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-extrabold">Colour</legend>
              <div className="flex gap-2">
                {PERSON_COLOURS.map((choice) => (
                  <button aria-label={`Use ${choice}`} aria-pressed={personColour === choice} key={choice} type="button" onClick={() => setPersonColour(choice)} className="h-10 w-10 rounded-full border-4" style={{ backgroundColor: choice, borderColor: personColour === choice ? 'var(--color-ink)' : 'transparent' }} />
                ))}
              </div>
            </fieldset>
            {error !== null && <ErrorNote>{error}</ErrorNote>}
            <GhostButton type="submit" disabled={personName.trim() === '' || busy}>{busy ? 'Adding…' : people.length === 0 ? 'Add this person' : 'Add another person'}</GhostButton>
          </form>
          <PrimaryButton onClick={() => setStep('screen')} disabled={people.length === 0 || busy}>
            {people.length === 0 ? 'Add at least one person to continue' : 'Continue'}
          </PrimaryButton>
        </div>
      )}

      {step === 'screen' && (
        <div className="mt-5 space-y-4">
          {screenAdded !== null ? (
            <>
              <p className="text-base leading-6 font-bold text-green-900">{screenAdded} has joined the household.</p>
              <p className="text-sm leading-5 text-ink-soft">Look at the screen. It should stop showing the code and start showing your household within a few seconds. More screens can be added under Displays whenever you like.</p>
              <PrimaryButton onClick={() => setStep('done')}>Continue</PrimaryButton>
            </>
          ) : (
            <>
              <p className="text-base leading-6 text-ink-soft">
                Is there a screen showing an OpenSkyLight code in your home? Adding it now means the calendar is on the wall before you put this phone down. Or add one later under Displays.
              </p>
              <AddScreenFlow onEnrolled={() => setScreenAdded('Your screen')} onClose={() => setStep('done')} />
              <GhostButton onClick={() => setStep('done')}>Add a screen later</GhostButton>
            </>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="mt-5 space-y-4">
          <p className="text-base leading-6 font-bold">Your household is set up.</p>
          <p className="text-sm leading-5 text-ink-soft">
            Everything you just did can be changed from this app — people under Household, where you live on the Home tab, screens under Displays. Next, connect a calendar under Calendar so the wall shows what is on.
          </p>
          <PrimaryButton onClick={finish}>Open the household</PrimaryButton>
        </div>
      )}
    </Card>
  )
}

/** A refused claim has one likely cause worth naming: somebody else got there
 * first. Everything else is the network. */
function explainClaim(reason: unknown, serverAddress: string): string {
  if (!(reason instanceof ApiError)) {
    return `Nothing answered at ${serverAddress}. Check this phone is on the same home Wi-Fi as the OpenSkyLight box rather than mobile data, then try again.`
  }
  if (reason.status === 409) {
    return 'This household was set up a moment ago — perhaps from another phone. Go back and connect with its PIN instead.'
  }
  if (reason.status === 401) return 'That PIN was not accepted. Use 4 to 64 digits.'
  return `That address answered, but refused to set up the household (${reason.status}): ${reason.message}`
}

const inputClass = 'min-h-14 w-full rounded-xl border border-line bg-paper px-4 text-base font-semibold outline-none focus:border-ember'

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-extrabold text-ink-soft">{label}</span>{children}<span className="mt-2 block text-sm font-semibold text-ink-faint">{help}</span></label>
}

function ErrorNote({ children }: { children: string }) {
  return <p className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800" role="alert">{children}</p>
}
