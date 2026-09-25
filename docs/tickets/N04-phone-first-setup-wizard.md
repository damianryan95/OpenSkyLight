# N04 - Phone-first setup wizard

Status: in progress (wizard built and driven; the `N02`/`N03` discovery half remains)
Depends on: N02, N03, P01, N18

## Amendment (2026-09-22): the wizard is entered by scanning a screen

[ADR 0006](../adr/0006-screen-initiated-pairing.md) changed how this flow
starts. The parent does not open the app cold and work through a linear wizard;
they scan the QR on an unregistered screen, and the wizard runs only when that
screen belongs to an **unclaimed** household. Adding a later screen to a
configured household must not re-enter it — which is now a property of
household state rather than a flag this ticket has to maintain.

The deliverable below is otherwise unchanged: PIN, location/timezone, the first
person, and the first display, in one flow, each step still independently
reachable afterwards. [`N18`](N18-screen-qr-enrolment.md) owns the scan and the
redemption cases; this ticket owns what happens after a household is claimed.

## Context

Read target-architecture section 8/Parent phone application. Read
`docs/tickets/P01-admin-shell.md` — this ticket builds a guided flow on top
of that shell, it does not replace the underlying admin pages.

## Deliverable

Replace today's cold start ("open `/admin/`, set a PIN, then find each admin
page yourself") with a guided first-run wizard in the companion app: join the
Pi's access point (`N02`) or confirm LAN discovery (`N03`), set the household
PIN, set location/timezone, add the first person, and register the first
display — one linear flow instead of five separate admin pages visited in an
undocumented order.

Likely files: `src/companion/src/pages` (new wizard flow), phone E2E tests.

## Acceptance

- A parent with a factory Pi and only a phone reaches a working, enrolled
  kiosk without reading external documentation.
- Every step the wizard automates remains independently reachable afterward
  for edits (people, calendars, displays stay editable from their existing
  pages).
- The wizard does not run again for an already-configured household.

Verify: phone-viewport E2E covering the full first-run path, plus a
re-run-safety test confirming a configured household is not re-wizarded.

## Built (2026-09-25)

`src/companion/src/pages/HouseholdSetupFlow.tsx`, entered two ways that converge
after the first step: scanning a brand-new screen (ADR 0006 case 1, which also
adds that screen), or typing the box's address and finding it has no PIN. In
both the parent never opens a browser.

Four steps, each a thin front on a page that already exists so nothing is set up
in a way that cannot be changed later: **claim** (choose and confirm the PIN,
name the phone, name the scanned screen), **where you live** (timezone prefilled
from the phone, optional town for weather — the shared `LocationPicker`, which
the Home tab's location card now also uses), **who lives here** (at least one
person), **your screen** (already in if scanned, else add one or defer).

### What is proven

- The full path on the built app bundle at a phone viewport
  (`scripts/e2e-phone-screen-enrolment.mjs`), and again against the real server
  on a fresh database: the PIN chosen on the phone is the household PIN, the
  phone is paired under its name, the person and timezone exist, the scanned
  screen is registered and collects its own credential.
- Re-run safety as a property of state: a configured household is not offered
  setup, from either entry, and a second claim is refused.
- Mismatched PINs cannot be submitted; setup cannot continue with nobody in the
  household.

### What is not

- The first acceptance line names a **factory Pi**: joining its access point
  (`N02`) and finding it by name (`N03`) are hardware-gated and not built. Today
  the address comes from the QR or is typed.
- No real camera has scanned a real screen. Manual code entry drives the same
  downstream code.
