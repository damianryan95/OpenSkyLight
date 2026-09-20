# ADR 0002: Provider-agnostic calendar access, without a Google OAuth layer

**Status:** Accepted (direction set by the project owner, 2026-09-20)
**Supersedes:** [ADR 0001](0001-headless-google-oauth.md)
**Date:** 2026-09-20
**Decision owner:** project owner

## Context

ADR 0001 committed the headless server to a Google-specific OAuth 2.0 Web
application flow. Working through it in practice, its deployment
prerequisites are out of reach for the non-technical household this product
is for. Before a single event can appear on the wall, an operator must:

- create a Google Cloud project and enable the Calendar API;
- configure an OAuth consent screen and complete verification, or manually
  enrol every household member as a test user;
- own a real registered domain, verify it, and terminate trusted HTTPS on it;
- run split-horizon DNS so that domain resolves to a LAN address;
- copy a client ID and client secret into the parent portal;
- choose a vault passphrase and re-enter it to unlock sync after every
  server restart.

That is a developer's integration path, not a product. It also binds the
household to one vendor: a user whose calendar lives in iCloud, Fastmail,
Nextcloud, or Exchange cannot use the product at all.

## Decision

Remove the Google-specific OAuth layer entirely. Replace it with two
provider-agnostic calendar sources, neither of which requires an API key, a
cloud project, a client secret, a registered domain, or trusted public HTTPS.

### Source A — phone-native connector (primary, zero configuration)

The companion phone app reads the calendars the phone already has, through
the operating system's own calendar APIs (EventKit on iOS, CalendarProvider
on Android), and pushes occurrences to the server over the LAN or the
remote-access channel from [ADR 0003](0003-self-hosted-remote-access.md).

Whatever the parent already uses — iCloud, Google, Exchange, a local
calendar — works because the phone has already been authorized by its owner.
The household grants one OS permission prompt. There is no second account to
connect and no credential for the server to hold.

### Source B — CalDAV and read-only ICS (freshness guarantee)

A parent may additionally point the server at a CalDAV collection
(URL plus an app-specific password) or a read-only ICS feed URL. CalDAV is an
open standard served by iCloud, Google, Fastmail, Nextcloud, Zimbra, and
others, so this remains provider-agnostic. It is still dramatically simpler
than ADR 0001: a URL and an app password, entered once, with no cloud project
and no domain ownership.

### Why both

Source A gives the best onboarding, but mobile platforms deliberately
restrict background execution. A phone-only sync path goes stale whenever
nobody opens the app, and a wall calendar that is wrong at 07:00 on a school
morning has failed at its only job. Source B keeps the board fresh with no
phone present. Households that want zero configuration use A alone and accept
that freshness tracks phone usage; households that want guaranteed freshness
add B.

## Consequences

- ADR 0001 is superseded. The registered-hostname, trusted-HTTPS, and
  split-horizon-DNS prerequisites disappear. A local mDNS name (`N03`) becomes
  sufficient for the entire product.
- The Google vault passphrase and the unlock-after-restart step are removed.
- `@googleapis/calendar` and `google-auth-library` are removed as
  dependencies. `ical.js` and `rrule`, already present, become primary.
- The event schema is de-Googled: `google_event_id` becomes `source_event_id`
  and gains a `source` discriminator. `google_accounts`,
  `google_configuration`, and `google_oauth_attempts` are removed from the
  migration sequence outright. There is no production data and no install to
  preserve, so the existing migrations are amended in place rather than
  reversed by a later one; existing volumes are discarded and rebuilt.
- `G01`–`G05` become historical tickets. `G05`'s sync-health model is reworked
  around per-source liveness (phone last-seen, CalDAV last-poll) rather than a
  single Google pull result.
- `src/shared/eventFeeds.ts` is already close to provider-agnostic and is the
  intended seam; its Google-specific wording and fields are corrected rather
  than replaced.
- No install-compatibility work is required. Households that used Google
  simply add it back as a CalDAV source — Google serves CalDAV with an
  app-specific password — or via the phone connector.

## Non-goals

- Writing a bespoke integration per calendar vendor. Only OS-native APIs and
  open standards (CalDAV, ICS) are in scope.
- Retaining any Google-specific code path "just in case". The layer is
  removed, not feature-flagged.

## Follow-up

`N13` retires the Google layer and de-Googles the schema. `N14` implements the
CalDAV/ICS source. `N05` implements the phone-native connector. `N06` covers
write-back once a read path exists.
