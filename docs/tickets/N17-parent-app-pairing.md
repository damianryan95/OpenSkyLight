# N17 - Parent app pairing and token authentication

Status: ready
Depends on: (none)

## Context

Read `docs/tickets/N05-native-calendar-connector-adr.md`, section "Blocker found
while scoping", which is why this ticket exists. Read
[ADR 0005](../adr/0005-phone-app-delivery-vehicle.md) for the delivery vehicle
this unblocks. Inspect `src/server/auth/` — particularly `DisplayDeviceService`,
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

Likely files: `src/server/auth/*`, `src/server/api/router.ts`,
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
