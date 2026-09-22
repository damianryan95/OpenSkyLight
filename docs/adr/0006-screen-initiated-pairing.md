# ADR 0006: Pair the household by scanning the screen, not the screen by the phone

**Status:** Accepted (direction set by the project owner, 2026-09-22)
**Date:** 2026-09-22
**Decision owner:** project owner
**Supersedes the enrolment ceremony in:** [`A03`](../tickets/A03-display-auth.md)
**Reshapes:** [`N04`](../tickets/N04-phone-first-setup-wizard.md)
**Builds on:** [ADR 0005](0005-phone-app-delivery-vehicle.md)

## Context

Display enrolment today runs in the wrong direction. A parent opens `/admin/`
in a browser, registers a display by name, and is handed a single-use
fragment link (`/#displayCredential=…`) which they must then somehow open on
the screen itself. That means typing a long secret URL on a wall-mounted
display, or emailing it to yourself, on a device that frequently has no
keyboard. `N16` records a real evening of deployment where exactly this step —
"an enrolment link that could not be moved between devices" — was one of the
failures that would end a non-technical household's attempt permanently.

The phone is the administration surface (ADR 0005). The screen is the thing
being administered. The ceremony should run that way round.

## Decision

**An unregistered screen displays a QR code. A parent's phone scans it.**

The QR carries the **server address plus a short-lived, single-use enrolment
code**. It never carries a credential. What redeeming that code does depends on
the state of the household:

1. **Household unclaimed** — no PIN is set and no phone is paired. The scanning
   phone runs first-run setup (household PIN, timezone, the household's
   people), and in the same act becomes the first paired admin phone *and*
   registers the screen. Trust on first use.
2. **Household claimed, scanning phone already paired.** The code redeems, the
   screen is registered, and nothing else happens. Adding a second screen is
   not a setup flow.
3. **Household claimed, scanning phone not paired.** The phone must
   authenticate with the household PIN, which pairs it as an admin phone, and
   the code then redeems as in case 2.

Case 2 is why "future screens are simply added" falls out of the state of the
household rather than needing a flag to suppress the wizard.

## Why a QR on a wall is not a standing credential giveaway

The enrolment code mints a **parent** credential in case 1 only. Once the
household is claimed, the code registers a screen, and registering a screen
requires admin authority — so a QR left on a kitchen wall for a year grants a
stranger nothing. This is the property that makes the whole ceremony safe, and
it is the thing to protect if any of this is changed later.

Pairing a phone requires the **household PIN**; a paired phone holds only a
bearer credential. A stolen phone therefore cannot mint itself a spare
credential, which is what makes revoking it genuinely final rather than
theatre.

## The residual risk, stated plainly

Case 1 is trust-on-first-use: whoever scans a brand-new screen *first* claims
the household. On a home LAN, with a code readable only by someone standing in
the room, that is the same trade every consumer device on the market makes, and
it is accepted here on that basis.

It is bounded rather than eliminated:

- the code is single-use and short-lived, and rotates while displayed;
- the screen shows who claimed it after pairing, so a hijack is visible rather
  than silent.

A household that wants more than this has no good option that does not
reintroduce a keyboard on the wall display, which is the problem being solved.

## The invariant this touches, declared rather than discovered

`K03` makes the kiosk read-only, and notes that an unhandled write channel from
a display is usually correct to refuse. **A screen requesting its own enrolment
code is display-initiated**, so it deserves an explicit ruling rather than a
quiet implementation.

It is permitted, narrowly: it happens before the screen is registered, it
writes no household data, and it mints nothing by itself — the code is inert
until a parent's scan authorises it. The screen asks to be adopted; it does not
adopt itself. Any widening of that channel is a new decision.

## Consequences

- **Discovery gets easier.** The screen knows the origin it was served from, so
  the QR carries the server address directly. The phone no longer has to find
  the server, which removes most of what `N03` exists to do for app clients.
  The numeric-address and mDNS paths still matter for the browser at `/admin/`.
- **`N04` is re-entered, not replaced.** Its deliverable — PIN, timezone, first
  person, first display — stays, but the flow is entered by scanning a screen
  rather than by opening the app cold, and it must not run for case 2.
- **The browser path at `/admin/` survives unchanged**, per ADR 0005: a
  household that installs nothing still has a fully working product. The QR
  ceremony is the app's way in, not the only way in.
- **`A03`'s server model survives intact** — named, revocable display
  credentials, parent-approved registration. Only the ceremony that delivers
  the credential to the screen changes.
- **Pairing a phone becomes an API action rather than an `/admin/` screen.**
  `N17` implements it as a PIN-authenticated route, so the app never needs a
  secret handed to it out of band.

## Follow-up

`N17` delivers the authentication substrate every variant of this needs: a
parent bearer credential accepted on parent routes with no cookie, no CSRF
token and no `Origin` header. `N18` implements the ceremony itself — enrolment
codes, the QR surface on an unregistered kiosk, and the three redemption cases
above.
