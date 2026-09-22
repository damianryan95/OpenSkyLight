# ADR 0005: Deliver the phone-native calendar connector with Capacitor

**Status:** Accepted (direction set by the project owner, 2026-09-22)
**Date:** 2026-09-22
**Decision owner:** project owner
**Implements part of:** [ADR 0002](0002-provider-agnostic-calendar-access.md)

## Context

ADR 0002 chose two calendar paths: a phone-native connector reading the
calendars the phone already holds, and server-side CalDAV/ICS. `N14` delivered
the second. The first has no delivery vehicle.

The companion at `/admin/` is a web application, and a browser cannot reach
EventKit on iOS or CalendarProvider on Android. Native calendar access requires
something installed on the phone, so `N05` cannot be built until that is
decided.

The Google experience makes this more valuable than it first appeared. Google's
CalDAV endpoint requires OAuth 2.0 and rejects app passwords, so Google users
are currently limited to per-calendar secret iCal links — one link per
calendar, revocable only by regenerating. A phone that has *already* authorised
the Google account sidesteps that entirely.

## Options considered

- **Capacitor** — wrap the existing companion in a native shell and add a
  calendar plugin. One codebase; the web app keeps working unchanged for anyone
  who does not install anything. Adds a build target rather than a frontend.
- **React Native** — a separate native app. Better native feel, but a second
  frontend to maintain forever, diverging from the companion already built.
- **Two native apps** (Swift and Kotlin) — the best result and roughly triple
  the work, leaving three UIs to maintain. Justifiable only if the phone app
  becomes the product's centre of gravity, which it is not.
- **Build nothing** — rely on CalDAV and ICS. Free, and gives up the
  zero-configuration promise.
- **A PWA with a share target** — no store and no native code, but no calendar
  API access either, so it cannot do what `N05` requires. Recorded because it
  is frequently proposed and does not work here.

## Decision

Use **Capacitor**, wrapping the existing companion application.

It reuses the companion rather than forking it, keeps the browser path alive
for households that will not install an app, and the single capability `N05`
needs — reading the device's calendars — is exactly what a plugin provides.
The alternatives either duplicate a frontend that already exists or solve a
problem the product does not have.

## The tension this creates, stated plainly

An app store listing makes **Apple and Google dependencies of a product whose
second principle is that the household owns its infrastructure and that no
third party operates any part of it**. ADR 0003 rejected Cloudflare Tunnel and
Tailscale's hosted plane on exactly that basis.

This is not the same thing — a store distributes the app, it does not operate
it, and nothing about the running system depends on the store afterwards. But
it is not nothing either, and it should not be discovered later and rationalised
then.

Two mitigations keep it honest:

- **Android can be sideloaded.** A signed APK distributed alongside the
  appliance image involves no store at all.
- **The connector is optional by design.** `N14` means a household that installs
  nothing still has a fully working calendar. The phone app improves the
  experience; it is not load-bearing, which is precisely why keeping CalDAV
  first-class was the right call.

If the store dependency later proves unacceptable, the fallback is the status
quo rather than a rebuild.

## Consequences

- **The companion gains a build target, not a rewrite.** Its code stays the
  single source for both web and app.
- **Distribution costs apply**: an Apple developer account (annual) and a Google
  Play account (one-off), or Android sideloading only.
- **Background execution limits do not go away.** Mobile platforms restrict
  background work, so a phone-sourced calendar still goes stale when nobody
  opens the app. That constraint is the reason ADR 0002 kept a server-side
  source, and Capacitor does not change it. Do not let the app's existence
  justify removing CalDAV.
- **Push, not pull.** The phone sends occurrences to the server; the server
  never holds a calendar credential. That property is worth protecting.
- **A `mobile-developer` agent becomes writable.** It was deliberately deferred
  until a platform existed to encode real constraints for.

## Follow-up

`N05` implements the connector and owns what remains: plugin selection,
permission flows, the push contract and its idempotency, and how the app is
built in CI. `N06` writes back through the same vehicle once a read path exists.
