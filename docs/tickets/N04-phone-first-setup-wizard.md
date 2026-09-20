# N04 - Phone-first setup wizard

Status: planned
Depends on: N02, N03, P01

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
