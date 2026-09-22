# N17 - Parent app pairing and token authentication

Status: done
Depends on: (none)

**Verified 2026-09-22** against a running server on a scratch database, driven
from `capacitor://localhost` with no cookie jar: every acceptance criterion
below passes, including revocation failing closed on the very next request and
both credential-confusion directions. The complete server log after a pairing,
a wrong-PIN attempt, bearer reads and mutations, and a revocation is one line.

**What is not proven:** no real app client exists yet, so the bearer path has
never been exercised from an actual Capacitor webview — and per the native
bridge section below, a naive webview `fetch` will not work. `N05`/`N18` own
that. Treat this ticket as a verified server capability, not as a working app.

## Amendment (2026-09-22): pairing is PIN-authenticated, not an `/admin/` mint

The Deliverable below originally had a parent-authorised action in `/admin/`
mint a credential shown exactly once. The project owner has since settled the
pairing ceremony in [ADR 0006](../adr/0006-screen-initiated-pairing.md): the
screen displays a QR, the phone scans it, and a phone authenticates with the
**household PIN**.

Pairing is therefore an API action — `POST /api/v1/parent-devices` with a PIN
and a device name — rather than a screen in `/admin/`. The app never needs a
secret handed to it out of band, and the route works from a foreign origin by
construction, which is the whole point of this ticket.

Everything else below stands, in particular the entire Security requirements
and Acceptance sections. This ticket remains the authentication substrate;
[`N18`](N18-screen-qr-enrolment.md) builds the ceremony on top of it.

Two consequences worth stating: minting requires the PIN while a paired phone
holds only a bearer credential, so a stolen phone cannot mint itself a spare —
which is what makes revocation final. And `/admin/` keeps a list-and-revoke
surface, because a lost phone has to be killable from a browser.

## The app must use a native HTTP bridge, not the webview's `fetch`

Found during review of this ticket, and it belongs to whoever builds the app
(`N05`, `N18`) rather than to the server.

The server sends **no `Access-Control-*` headers**, deliberately — adding them
would hand back much of what `assertSameOrigin` buys the browser path. But a
request carrying an `Authorization` header is never CORS-simple, so a webview
`fetch` to the household server preflights, and that preflight has nothing to
answer it. **The bearer path is therefore unreachable from an ordinary
Capacitor webview `fetch`.**

The fix is the one Capacitor already ships: route requests through the native
HTTP layer (`CapacitorHttp`, which patches `window.fetch`), which is not
subject to CORS at all. This is not a server change and must not become one.
Discover it here rather than at integration time.

## Context

Read `docs/tickets/N05-native-calendar-connector-adr.md`, section "Blocker found
while scoping", which is why this ticket exists. Read
[ADR 0005](../adr/0005-phone-app-delivery-vehicle.md) for the delivery vehicle
this unblocks. Inspect `src/server/auth/index.ts` — particularly `DisplayDeviceService`,
which already implements the pattern this ticket generalises.

The parent authentication model is same-origin by construction:

- `assertSameOrigin` in `src/server/api/router.ts` requires the `Origin` header
  to equal `protocol://host` exactly.
- The parent session is an `HttpOnly; SameSite=Lax` cookie scoped to
  `/api/v1`. `SameSite=Lax` is not sent cross-site, and `SameSite=None` would
  require `Secure`, which a plain-HTTP LAN deployment does not have.
- `src/companion/src/api/client.ts` calls relative paths with
  `credentials: 'same-origin'`.

A Capacitor webview's origin is `capacitor://localhost`, so all three fail. All
56 parent routes go through `requireParentRead`/`requireParentMutation`, which
read the cookie; none accepts a bearer token. Until that changes, `N05` cannot
authenticate at all.

## Deliverable

Let a parent phone app authenticate as a first-class client from a different
origin, without weakening the browser path.

- **Pair a phone with its own credential**, following the display registration
  model rather than inventing a second one: a parent-authorised action in
  `/admin/` mints a credential shown exactly once, the app stores it, and it is
  independently revocable. Reuse `DisplayDeviceService`'s shape and its hashing;
  do not copy it wholesale if a shared abstraction is cleaner.
- **Accept that credential on parent routes.** `requireParentRead` and
  `requireParentMutation` gain a bearer path alongside the cookie. A
  bearer-authenticated request carries no ambient credential, so it needs
  neither the CSRF token nor the origin check — state that in the code, because
  the next reader will wonder.
- **Keep the browser path exactly as it is.** The cookie, CSRF token and
  origin check remain for `/admin/` in a browser. This ticket adds a second way
  in; it does not replace the first.
- **Make the companion's API client origin-aware.** It currently hardcodes
  relative paths. It needs a configurable base URL and a bearer mode, while
  continuing to default to same-origin cookies when served from `/admin/`.
- **List and revoke paired phones** in parent administration, exactly as
  displays are listed and revoked.

Likely files: `src/server/auth/index.ts`, `src/server/api/router.ts`,
`src/server/db/migrations.ts`, `src/shared/api/contract.ts`,
`src/companion/src/api/client.ts`, `src/companion/src/pages/*`, tests.

## Security requirements

These are the reason this is its own ticket rather than a line in `N05`.

- A phone credential is **parent-level**. It is far more powerful than a
  display credential, which is read-only apart from today's chores. Treat it
  accordingly: show it once, store only a hash, never log it, never put it in a
  URL or query string.
- **Revocation must be immediate**, and a revoked credential must fail closed
  on the very next request.
- **Pairing must be a parent-authorised action**, not something an unpaired
  client can initiate.
- Rate-limit credential presentation the way the PIN endpoint should be
  (see `N07`), so a stolen device or a guessed token cannot be brute-forced.

  **How this was satisfied, and the one deliberate exception.** *Minting* is
  rate-limited: pairing checks the PIN through the ordinary login path, so a
  wrong PIN feeds the same `auth_attempt_state` counter and backoff the PIN
  screen uses. *Presentation* of an already-minted bearer credential is
  deliberately **not** counted. The credential is 32 random bytes; an online
  attacker gets no useful fraction of 2^256 at any request rate a counter would
  change, so throttling would add lockout risk for a legitimate phone and buy
  nothing. If the credential ever shrinks or becomes user-chosen, this stops
  being true and the exception must go.

  **A pairing request must carry `Content-Type: application/json`**, enforced
  in `router.ts`. This looks like pedantry and is not: pairing is the one route
  with no origin check and no required custom header, which would otherwise
  make it a CORS-*simple* request that any page a parent visits can send
  without a preflight. Four forged requests would then put the household-wide
  PIN backoff into lockout. Demanding JSON forces a preflight that fails for
  want of any CORS response header. This was found by review, reproduced
  against a running server, and is covered by a test.
- Do not weaken `assertSameOrigin` or change the cookie's `SameSite` to make
  this easier. Both were deliberate, and loosening them would degrade the
  browser path to serve the app path.

## Acceptance

- A parent pairs a phone from `/admin/`, and a client at an unrelated origin
  can then read and mutate household state using only that credential.
- The same client is refused entirely once the credential is revoked.
- The browser path is unchanged: cookie, CSRF and origin checks all still
  apply, and existing tests covering them still pass untouched.
- A bearer-authenticated request with no cookie and no CSRF token succeeds; a
  request with neither credential is refused.
- A display credential cannot be used on a parent route, and a phone
  credential cannot be used to impersonate a display.
- Credentials never appear in logs, diagnostics, event payloads or URLs.

Verify: authorisation tests covering both paths and their confusion cases,
a revocation test asserting immediate failure, a cross-origin test proving the
bearer path needs no `Origin` header, and a regression run of the existing
parent-auth suite.
