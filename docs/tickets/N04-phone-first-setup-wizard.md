# N04 - Phone-first setup wizard

Status: planned
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
