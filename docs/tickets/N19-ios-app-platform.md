# N19 - iOS app platform and verification

Status: blocked
Blocked by: **no Mac.** Xcode is required to build, sign, or run an iOS app,
and it exists only on macOS. This is a hardware dependency of the same kind
`O02` has, not a scheduling preference.
Depends on: N05 phases 1-3 (the Android app and the calendar connector it
verifies against)

## Context

Read [ADR 0005](../adr/0005-phone-app-delivery-vehicle.md), which chose
Capacitor precisely so that a second platform is a build target rather than a
second codebase. Read `docs/tickets/N05-native-calendar-connector-adr.md` and
its phase split — this ticket is the iOS half of what `N05` originally carried
in one acceptance criterion.

The owner's direction (2026-09-23) is **Android first**. `N05` is therefore
scoped to Android, and everything iOS-specific lives here so that `N05` can
actually reach `done` instead of sitting permanently blocked on hardware
nobody has yet.

Nothing about this is speculative work deferred out of laziness: the app is one
codebase, the pairing flow and the push contract are platform-agnostic, and the
Android work has already proven both. What remains genuinely differs per
platform, and all of it needs a Mac in the room.

## Deliverable

The same companion app, running and verified on iOS.

- **Add the iOS platform** (`npx cap add ios`) and get the shell building.
- **Re-prove pairing on iOS.** The `N17` bearer path is platform-agnostic in
  principle, but the two things that made it work on Android are not:
  `CapacitorHttp` must be doing the same CORS-bypassing job through
  `WKWebView`, and **App Transport Security is iOS's equivalent of the Android
  cleartext block** — it refuses plain HTTP by default and will fail every
  request to a LAN server until `NSAppTransportSecurity` is configured. Expect
  to solve the same problem a second time in a different place, and record it
  next to the Android note in `N05`.
- **Local network permission.** iOS 14+ prompts before an app may talk to
  devices on the local network, and a household server is exactly that. The
  prompt needs a usage string a non-technical parent understands, and the
  refusal path needs to say what to do rather than failing silently.
- **Calendar access through EventKit**, matching whatever `N05` phase 3 built
  on `CalendarProvider`, including its permission flow and its
  partial-access behaviour on newer iOS versions.
- **Background refresh**, to whatever extent iOS grants it — and the same
  honest in-UI statement of the limit that `N05` requires, since iOS is the
  stricter of the two platforms.
- **Distribution.** ADR 0005 notes an Apple developer account is an annual
  cost, and that unlike Android there is **no sideloading escape hatch**: the
  App Store is the only route to an ordinary household's iPhone. That tension
  is already recorded in ADR 0005 under "The tension this creates"; this ticket
  is where it becomes real money and a real review process.

## Acceptance

- The app installs on a physical iPhone and pairs with a household server over
  plain HTTP on the LAN, with the local-network prompt handled.
- A parent grants calendar permission and sees those events on the kiosk.
- Revoking that phone from a browser cuts it off on its next request, matching
  the Android behaviour verified in `N05` phase 1.
- Background staleness is surfaced honestly rather than silently wrong.

Verify: a real-device check on a physical iPhone. A simulator is not
sufficient for this ticket — the local-network prompt, background refresh and
calendar permissions all behave differently there, and those are most of what
this ticket exists to prove.

## Note for whoever picks this up

Do not let the absence of iOS block Android delivery, and do not let iOS
arrive by quietly weakening something that works on Android. The likely
temptation will be to add CORS headers to the server when App Transport
Security or `WKWebView` misbehaves. That is the wrong fix and it degrades the
browser at `/admin/` — see `N17`'s security requirements.
