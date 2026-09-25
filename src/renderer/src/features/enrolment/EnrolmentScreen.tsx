import { useEffect, useState, type ReactNode } from 'react'
import { consumeDisplayRevokedNotice } from '../../api/browser'
import { CheckIcon } from '../../components/icons'
import { QrCode } from './QrCode'
import { useEnrolment } from './useEnrolment'
import {
  ENROLMENT_CONFIRMATION_MS,
  describeRefresh,
  enrolmentQrPayload,
  formatEnrolmentCode,
  millisecondsRemaining
} from './enrolment'

/** Without the scheme — "192.168.1.50:3000" reads as an address a household can
 * act on, "http://…" reads as noise from across a room. */
function readableHost(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

/** Where a parent goes if the camera fails and they type it instead. */
function readableAddress(origin: string): string {
  return `${readableHost(origin)}/admin`
}

/**
 * The first thing a household ever sees of OpenSkyLight, on a wall, from across
 * a room, with nothing set up and no keyboard.  It must explain itself with no
 * prior knowledge, and it must never present a dead end: every failure here
 * retries itself and says so.
 *
 * Read `docs/adr/0006-screen-initiated-pairing.md` before changing the
 * ceremony. The screen asks to be adopted; it does not adopt itself (`K03`).
 */
export function EnrolmentScreen() {
  const { state, now } = useEnrolment()
  const origin = window.location.origin
  // Read once at mount and cleared: it belongs to this boot only.
  const [revoked] = useState(() => consumeDisplayRevokedNotice())

  // Bringing the board up is a full reload: the display credential is now in
  // storage, and a fresh boot is the one deterministic way to start the event
  // stream and every authenticated query from a clean state. The pause before
  // it is the point — ADR 0006 wants a hijacked first run to be seen.
  const registered = state.phase === 'adopted'
  useEffect(() => {
    if (!registered) return
    const timer = window.setTimeout(() => window.location.reload(), ENROLMENT_CONFIRMATION_MS)
    return () => window.clearTimeout(timer)
  }, [registered])

  if (state.phase === 'adopted') {
    return (
      <Frame>
        <div className="flex max-w-[54rem] flex-col items-center gap-6 text-center" data-enrolment-phase="adopted">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-ember text-white shadow-card">
            <CheckIcon size={54} />
          </span>
          <h1 className="font-display text-[clamp(2.4rem,4vw,4rem)] leading-tight font-semibold">
            This screen is now “{state.displayName}”
          </h1>
          <p className="text-[clamp(1.2rem,1.7vw,1.85rem)] leading-snug text-ink-soft">
            Added by the phone that just scanned it. If that was not someone in your household, remove this screen from
            the OpenSkyLight app on your phone.
          </p>
          <p aria-live="polite" role="status" className="text-[clamp(1.05rem,1.4vw,1.5rem)] font-bold text-ink-faint">
            Opening your family board…
          </p>
        </div>
      </Frame>
    )
  }

  if (state.phase === 'offline') {
    return (
      <Frame>
        <div className="flex max-w-[54rem] flex-col items-center gap-6 text-center" data-enrolment-phase="offline">
          <h1 className="font-display text-[clamp(2.2rem,3.6vw,3.5rem)] leading-tight font-semibold">
            This screen cannot reach your household server
          </h1>
          <p className="text-[clamp(1.2rem,1.7vw,1.85rem)] leading-snug text-ink-soft">
            It is looking for OpenSkyLight at <span className="font-bold text-ink">{readableHost(origin)}</span> on your
            home network. Check the server is switched on and connected.
          </p>
          <p aria-live="polite" role="status" className="rounded-full bg-paper-deep px-6 py-3 text-[clamp(1.05rem,1.4vw,1.5rem)] font-bold text-ink-soft">
            Still trying — nothing to do on this screen
          </p>
        </div>
      </Frame>
    )
  }

  const code = state.phase === 'showing' ? state.code : null
  const remaining = state.phase === 'showing' ? millisecondsRemaining(state.expiresAt, now) : 0

  return (
    <Frame>
      {/* Centred as a group rather than stretched across the shell: on a
          2400x900 panel a stretched grid strands the composition to one side. */}
      <div
        className="flex w-full max-w-[1500px] flex-col items-center justify-center gap-8 lg:flex-row lg:gap-14"
        data-enrolment-phase={code === null ? 'preparing' : 'showing'}
      >
        <div className="flex w-[min(46vh,32vw,520px)] min-w-60 shrink-0 flex-col items-center gap-3">
          {code === null
            ? <div className="aspect-square w-full rounded-3xl bg-card shadow-card" aria-hidden="true" />
            : <QrCode payload={enrolmentQrPayload(origin, code)} label="Setup code for this screen" />}
          <span className="text-[clamp(1rem,1.2vw,1.35rem)] font-extrabold tracking-wide text-ink-faint uppercase">
            Scan with your phone
          </span>
        </div>

        <div className="flex max-w-[44rem] flex-col gap-5 text-center lg:text-left">
          {revoked && (
            <p role="status" data-enrolment-revoked="true" className="self-center rounded-full bg-paper-deep px-6 py-3 text-[clamp(1.05rem,1.4vw,1.5rem)] font-bold text-ink-soft lg:self-start">
              This screen was removed from the household. Scan the code to add it back.
            </p>
          )}
          <h1 className="font-display text-[clamp(2.4rem,4vw,4rem)] leading-tight font-semibold">
            Set up this screen
          </h1>
          <p className="text-[clamp(1.2rem,1.7vw,1.85rem)] leading-snug text-ink-soft">
            Open the <span className="font-bold text-ink">OpenSkyLight</span> app on your phone and scan the code on
            this screen. Your phone does the rest.
          </p>

          <div className="rounded-3xl bg-card px-7 py-5 shadow-card">
            <div className="text-[clamp(0.95rem,1.1vw,1.2rem)] font-extrabold tracking-wide text-ink-faint uppercase">
              Or type this code
            </div>
            {code === null
              ? (
                <div aria-live="polite" role="status" className="py-2 text-[clamp(1.6rem,2.6vw,2.6rem)] leading-tight font-bold text-ink-faint">
                  Getting a code…
                </div>
              )
              : (
                <div data-enrolment-code="true" className="py-1 text-[clamp(2.8rem,5.2vw,5rem)] leading-tight font-black tracking-[0.12em] text-ink">
                  {formatEnrolmentCode(code)}
                </div>
              )}
            <div className="text-[clamp(1rem,1.3vw,1.4rem)] leading-snug text-ink-soft">
              In the app, or in any phone browser at <span className="font-bold text-ink">{readableAddress(origin)}</span>
            </div>
          </div>

          <p aria-live="polite" role="status" className="min-h-8 text-[clamp(1rem,1.3vw,1.4rem)] font-bold text-ink-faint">
            {code === null ? '' : describeRefresh(remaining)}
          </p>
        </div>
      </div>
    </Frame>
  )
}

/** Shares the kiosk's centred, max-width shell so enrolment sits in the same
 * visual language as the board it becomes (`K04`). No motion: this screen may
 * be up for hours, and reduced motion must get the same static presentation. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="kiosk-app-shell flex h-full flex-col items-center justify-center px-10 py-8">
      {children}
    </div>
  )
}
