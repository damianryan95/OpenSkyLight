# N05 - Phone-native calendar connector

Status: in progress (phase 1 of 4 — see the split below)
Depends on: N13, N17; delivery vehicle settled by ADR 0005

## Split proposed (2026-09-22)

This ticket anticipated being split once scoped, and it needs to be: it spans a
build system, a native platform, a server contract and an OS permission flow,
and only one of those can be verified without a physical phone. Reported here
rather than carved into the backlog unilaterally — the phases are the proposal,
not a decision.

1. **The Capacitor shell and app pairing** — Capacitor 8, a second Vite build
   target for the native shell, the native HTTP bridge, in-app pairing against
   the `N17` credential, and the Android platform. Delivers an installed app
   that can administer the household from a foreign origin. **This phase is
   being built now.**
2. **The phone push contract** — the server route phase 3 pushes occurrences
   to, with its idempotency, ordering, deletion reconciliation and per-source
   last-seen feeding sync health. Server-side and fully testable with no device
   at all, which is why it is worth separating: it is the part most likely to
   be got subtly wrong and the part easiest to prove. `calendar_sources.kind`
   already permits `'phone'`, so the schema is waiting for it.
3. **Native calendar read and mapping** — plugin selection, the permission
   flows, the calendar-selection and person-mapping UI, wired to phase 2. Needs
   a real Android device; this is the ticket's actual acceptance bar.
4. **App build in CI** — APK in CI, signing, and artefact publication.

**This ticket is Android-only** (owner's direction, 2026-09-23). iOS needs
Xcode and therefore a Mac, which would leave `N05` permanently blocked on
hardware nobody has. Everything iOS-specific — the platform, App Transport
Security, the local-network prompt, EventKit, and App Store distribution — is
carved out as [`N19`](N19-ios-app-platform.md), which is `blocked` on that
hardware and honest about it.

So the four phases above are Android phases, and this ticket's acceptance is
met when Android is proven. `N19` re-proves the same criteria on iOS later; it
does not get to change them, and it must not arrive by weakening something
Android already relies on.

### Building the Android app

`npm run build:app` produces the shell bundle in `out/app` (a second Vite
config, because `/admin/` is meaningless inside a native shell). `npm run
app:sync` rebuilds it and copies it into the Android project. The APK itself is
Gradle's, and needs a JDK and the Android SDK on the environment rather than in
the repo:

```fish
set -x JAVA_HOME "/c/Program Files/Android/Android Studio/jbr"
set -x ANDROID_HOME "$HOME/AppData/Local/Android/Sdk"
cd android; and ./gradlew assembleDebug
```

Android Studio's bundled JBR is a perfectly good JDK and saves installing a
second one. The debug APK lands in
`android/app/build/outputs/apk/debug/app-debug.apk`.

**`CapacitorHttp` must stay enabled** in `capacitor.config.ts`. It is not a
performance tweak: the webview origin is `https://localhost`, the parent
credential travels in an `Authorization` header, that header always triggers a
CORS preflight, and the server answers none by design. Without the native HTTP
bridge the app authenticates against nothing. See `N17`'s section "The app must
use a native HTTP bridge".

**Cleartext is a second, separate switch, and it is the one that will catch
you.** Android has blocked plain HTTP at the platform level since API 28, so a
freshly generated Capacitor project builds, installs, launches and then fails
every single request with a bare network error — which reads exactly like a
wrong address. `allowMixedContent` in `capacitor.config.ts` does *not* lift it;
that governs subresources inside the webview. The switch is
`android/app/src/main/res/xml/network_security_config.xml`, referenced from
`AndroidManifest.xml`. Both files are ours, not generated, so `cap sync` leaves
them alone. The config explains why permitting cleartext is consistent with
ADR 0002 and ADR 0003 rather than a lapse.

### Verified on a real device (2026-09-23)

Phase 1 was driven on an Android emulator (API 36.1) against a real server on a
scratch database, not only built:

- The app installs, launches, and renders the pairing screen.
- Pairing with a server address and the household PIN succeeds over the native
  HTTP bridge from `https://localhost` — a genuinely foreign origin.
- The app then shows live household data, proving the `N17` bearer path end to
  end through a real webview rather than through a test harness.
- `parent_devices` holds one row whose `last_seen_at` advances after pairing,
  confirming the credential authenticates subsequent requests; only a 32-byte
  digest is stored.
- Revoking that phone from a browser drops the app back to the pairing screen
  on its next foreground, keeping the server address but demanding the PIN
  again.
- The complete server log for that whole cycle is one line. No credential, no
  PIN, and the PIN backoff counter finished at zero.

**Still unverified:** background refresh, and anything involving an actual
calendar — phases 2 and 3 have not started. iOS is out of scope here and
tracked as [`N19`](N19-ios-app-platform.md).

## Context

Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md)
section "Source A". This ticket was previously a blocked decision spike; the
decision is made and it is now an implementation ticket. Build on the
provider-agnostic seam `N13` leaves behind.

## Deliverable

The companion phone app reads the calendars the phone already holds, through
the operating system's own API — **`CalendarProvider` on Android**; EventKit on
iOS is [`N19`](N19-ios-app-platform.md) — and pushes occurrences to the server.
The household grants one OS permission prompt; there is no account to connect,
no API key, and no credential for the server to store.

Keep the seam between "read this phone's calendars" and "push occurrences"
clean enough that `N19` swaps the reader and nothing else. The push contract is
platform-agnostic and should stay that way.

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
access, the Android permission flow, the push contract and its idempotency, and
how the app is built in CI. The split this invited has been made — see "Split
proposed" at the top.

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

### Carried forward from `N17` (2026-09-22)

`N17` landed the bearer path, and surfaced one constraint this ticket owns:
**the app must talk to the server through Capacitor's native HTTP layer, not
the webview's own `fetch`.** The server sends no CORS headers by design, and an
`Authorization` header always triggers a preflight, so a plain webview `fetch`
cannot use the credential at all. See `N17`'s section "The app must use a
native HTTP bridge". Budget for it in plugin selection rather than meeting it
at integration.

## Acceptance

Android only; [`N19`](N19-ios-app-platform.md) re-proves these on iOS.

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
Android. An emulator has already proven the phase 1 pairing path end to end,
but a phone's own calendar and its background behaviour are not things an
emulator can stand in for — phase 3 needs real hardware.
