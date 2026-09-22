# N18 - Screen-displayed QR enrolment and household claim

Status: planned
Depends on: N17; ceremony settled by ADR 0006

## Context

Read [ADR 0006](../adr/0006-screen-initiated-pairing.md) in full — it is the
spec for this ticket, including the security property that makes a wall-mounted
QR safe and the `K03` ruling that permits a display to ask for its own
enrolment code.

Read `docs/tickets/N17-parent-app-pairing.md`, which delivers the
authentication substrate this builds on: a parent bearer credential accepted on
parent routes with no cookie, no CSRF token and no `Origin` header, and a
PIN-authenticated pairing route.

Read `docs/tickets/N04-phone-first-setup-wizard.md`. This ticket does not
reimplement the wizard; it changes how the wizard is *entered* and makes it
conditional on household state.

Today's ceremony runs the wrong way round: a parent registers a display in
`/admin/` and is handed a fragment link they must somehow open on the screen.
`N16` records that step failing in real deployment.

## Deliverable

An unregistered screen displays a QR code; a parent's phone scans it and the
screen is adopted.

- **Enrolment codes.** A server-side service minting short-lived, single-use
  codes. A code is inert on its own: it identifies an enrolment attempt, not a
  credential. It rotates while displayed and expires quickly.
- **An enrolment surface on the unregistered kiosk.** When
  `src/renderer` holds no display credential, it requests a code and renders
  the QR, alongside a human-readable fallback for a phone that cannot scan.
  The QR encodes the server address the kiosk was served from, plus the code.
- **Three redemption cases**, exactly as ADR 0006 defines them: unclaimed
  household runs first-run setup and claims it; paired phone simply adds the
  screen; unpaired phone authenticates with the household PIN first.
- **Confirmation on the screen.** After adoption the screen shows which phone
  claimed it, so a hijacked first-run is visible rather than silent.
- **Re-entry into `N04`'s wizard** for the unclaimed case only. A configured
  household adding its fourth screen must not be re-wizarded.

Likely files: `src/server/auth/index.ts`, `src/server/api/router.ts`,
`src/server/db/migrations.ts`, `src/shared/api/contract.ts`,
`src/renderer/src` (enrolment surface), `src/companion/src` (scan and redeem),
tests.

## Security requirements

- **A code never carries a credential**, and never appears in a log, a
  diagnostic, or a URL the server records.
- **Single use and short-lived.** A redeemed or expired code is refused, and
  refusing is not distinguishable in timing or message from a code that never
  existed.
- **Rate-limit redemption** so codes cannot be guessed, and reuse the existing
  PIN backoff for the case-3 PIN check rather than inventing a second one.
- **Only case 1 mints a parent credential.** Once the household is claimed, a
  code must not be able to produce one. This is the property the whole ceremony
  rests on — test it directly, not by inspection.
- **The display's channel stays narrow.** A screen may ask for a code and learn
  whether it has been adopted. It may not learn anything about the household,
  the people, or the phone until it holds a display credential.

## Acceptance

- A factory-fresh screen and a phone with the app produce a working, enrolled
  kiosk and a configured household, with no browser, no typed URL and no
  keyboard on the screen.
- A second screen added to that household is enrolled by scanning, and the
  setup wizard does not run.
- A third phone scanning any screen is refused until it supplies the household
  PIN, after which it is paired and can enrol.
- A code that has been redeemed once is refused the second time.
- After the household is claimed, no code can mint a parent credential.
- The screen displays which phone adopted it.
- The `/admin/` browser path still works for a household that installs nothing.

Verify: redemption tests covering all three cases and the claimed/unclaimed
fork, a single-use and expiry test, a test asserting no parent credential is
mintable post-claim, and a real end-to-end run — a genuinely unregistered
kiosk, a real scan, and a screen that ends up showing household data. A green
test suite is not evidence for this ticket; the ceremony spans three processes
and has to be driven.
