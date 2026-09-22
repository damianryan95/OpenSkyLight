# N05 - Phone-native calendar connector

Status: planned
Depends on: N13, N17; delivery vehicle settled by ADR 0005

## Context

Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md)
section "Source A". This ticket was previously a blocked decision spike; the
decision is made and it is now an implementation ticket. Build on the
provider-agnostic seam `N13` leaves behind.

## Deliverable

The companion phone app reads the calendars the phone already holds, through
the operating system's own APIs (EventKit on iOS, CalendarProvider on
Android), and pushes occurrences to the server. The household grants one OS
permission prompt; there is no account to connect, no API key, and no
credential for the server to store.

- Let the parent choose which of the phone's calendars to share, and map each
  to Family or a household member using the existing mapping UI.
- Push occurrences for a bounded forward window on app open, on calendar
  change notification, and on whatever background refresh the platform grants.
- Make the push idempotent and ordered so repeated or out-of-order pushes
  cannot duplicate or resurrect deleted occurrences.
- Record a per-source last-seen timestamp feeding the sync-health surface, so
  the board can show that phone-sourced data is going stale.
- Reconcile deletions explicitly: an occurrence absent from a full-window push
  is removed, so a cancelled event does not linger on the wall.

Note the platform limitation honestly in the UI: background execution is
restricted on both mobile platforms, so freshness tracks phone usage. A
household that needs guaranteed freshness adds a CalDAV source (`N14`)
alongside this; both sources coexist under the same schema.

[ADR 0005](../adr/0005-phone-app-delivery-vehicle.md) settles the delivery
vehicle: **Capacitor**, wrapping the existing companion rather than forking it.
The web app at `/admin/` keeps working unchanged for households that install
nothing.

What remains open and belongs to this ticket: plugin selection for calendar
access, the permission flows on both platforms, the push contract and its
idempotency, and how the app is built in CI. Splitting the ticket once that is
scoped is reasonable — report the split rather than silently expanding.

Note the constraint ADR 0005 restates: Capacitor does **not** remove mobile
background-execution limits. A phone-sourced calendar still goes stale when
nobody opens the app, which is why `N14` stays first-class. Do not let this
ticket's existence become an argument for removing the server-side source.

Likely files: companion app mobile layer (new), a push API route in
`src/server/api/router.ts`, `src/shared/api/contract.ts`,
`src/server/domain/eventFeeds.ts`, tests.

## Blocker found while scoping (2026-09-22)

**The parent authentication model is same-origin by construction and a
Capacitor app is not same-origin.** This is a prerequisite, not a detail, and
it must be solved before any calendar work begins.

Three things all assume the client is served by the household server itself:

- `assertSameOrigin` (`router.ts`) requires the `Origin` header to equal
  `protocol://host` exactly. A Capacitor webview's origin is
  `capacitor://localhost` or `http://localhost` and can never match, so login
  and every mutation would return 403.
- The parent session is an `HttpOnly; SameSite=Lax` cookie scoped to
  `/api/v1`. `SameSite=Lax` is not sent cross-site, and `SameSite=None` would
  require `Secure`, which a plain-HTTP LAN deployment does not have.
- The companion's client calls relative paths (`/api/v1/...`) with
  `credentials: 'same-origin'`, both of which resolve to the app bundle rather
  than the server.

All 56 parent routes go through `requireParentRead`/`requireParentMutation`,
which read the cookie. None accepts a bearer token.

### The options

- **Pair the app with a bearer credential**, exactly as displays already do
  (`readBearerToken`, `displays.authenticate`). No ambient cookie means no
  CSRF surface and no origin check needed on those requests. It reuses a
  pattern already proven in this codebase, and the app becomes a first-class
  client rather than a browser in a costume. **Recommended.**
- **Load the server's own URL in the webview** (Capacitor's `server.url`).
  Same-origin holds, cookies work, and plugins are still injected — much
  cheaper. But the app renders nothing when the server is unreachable, which
  is a poor experience away from home and awkward alongside `N07`.
- **CORS with `SameSite=None`** — weakens the CSRF posture and demands HTTPS
  the LAN does not have. Not recommended.

### Split

Carved out as [`N17`](N17-parent-app-pairing.md) — app pairing and token
authentication for a non-same-origin parent client — and must land first. This
ticket then builds on a client that can actually talk to the server.

## Acceptance

- A parent grants calendar permission on the phone and sees those events on
  the kiosk without entering any URL, key, or password.
- Repeated pushes are idempotent; deleted and cancelled events disappear from
  the board.
- Phone-sourced and CalDAV-sourced events coexist without duplication when
  both point at the same underlying calendar.
- Stale phone-sourced data is visibly indicated rather than silently wrong.
- No calendar credential from the phone is ever transmitted to or stored on
  the server; only occurrence data is pushed.

Verify: idempotency and deletion-reconciliation tests, duplicate-source
tests against `N14`, staleness-indicator test, and a real-device check on
both mobile platforms.
