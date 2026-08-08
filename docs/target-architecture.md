# OpenSkyLight Target Architecture and Implementation Plan

Status: approved product direction, ready for implementation planning  
Last updated: 2026-08-08

## 1. Purpose

This document defines the target architecture for refactoring OpenSkyLight from a
standalone Electron appliance into a LAN-hosted household service with browser
kiosk displays and a phone-first administration interface.

It is the authoritative direction for the refactor and supersedes the earlier
Electron-focused platform approach in `docs/platform-support-roadmap.md` where
the two documents conflict.

The refactor must preserve the existing wall-display visual identity. It changes
where data and platform responsibilities live; it is not a UI redesign.

## 2. Agreed Product Decisions

### Deployment and clients

- One Docker-hosted OpenSkyLight server runs in the home lab.
- The application considers itself LAN-only. Remote access, if desired, is
  provided separately by the operator through a VPN.
- Raspberry Pi-like display devices run Chromium in kiosk mode.
- Multiple displays connect to the same household server and database.
- Parent administration is performed primarily from a phone browser.
- There is no requirement for a physical keyboard or mouse during normal use.

### Household and personal views

- Every household member has an avatar and a personal view.
- Displays always start in Family view after a launch or reboot.
- Switching to a personal view is done by tapping the person's avatar.
- Switching is manual only. Idle time and the screensaver do not reset the view.
- Family view shows all household events.
- Personal view shows only events associated with that person.
- An event associated with nobody appears in Family view only.
- Shared widgets remain visible in personal views. Calendar, chores, balances,
  and rewards adapt to the selected person.

### Display permissions

- Calendar views and event details are read-only on displays.
- Users may navigate Day, Week, Month, and Agenda views.
- Weather and other widgets may be explored, but are otherwise read-only.
- The only display-side mutation is completing or undoing today's chores.
- Displays cannot change past or future chore completion records.
- Parent administration owns all other mutations.

### Google Calendar

- Google Calendar is the exclusive event editor and source of truth.
- OpenSkyLight performs one-way synchronization from Google.
- Parents create, edit, move, and delete events in Google Calendar, not in
  OpenSkyLight.
- A separate Google calendar is used for Family and for each person.
- Each selected Google calendar maps to either one household member or Family.
- The mapped calendar supplies the event's default person association.
- Exact child-name matches in an event title or description add those children
  to the event's audience.
- Name inference applies only to household members whose role is `child`.
- OpenSkyLight does not maintain local per-event assignment overrides.
- Cached Google events remain visible when Google or the Internet is unavailable.

### Removed and deferred capabilities

- Remove RTSP/IP camera functionality.
- Remove BirdNET functionality.
- Do not import an existing standalone OpenSkyLight database; the server starts
  with a fresh household setup.
- Do not provide public-Internet application security in the initial design.
- Do not implement peer-to-peer database replication between displays.
- Defer full offline editing and conflict resolution.
- The initial refactor preserves an extension point for full-screen
  chore-completion animations. Person themes and the production animation
  follow-up are defined in [`personalization-roadmap.md`](personalization-roadmap.md).

## 3. System Topology

```text
                              Google Calendar API
                                      |
                                      v
                         +---------------------------+
                         | OpenSkyLight Server       |
                         |                           |
                         | HTTP API + event stream   |
                         | Google pull synchronizer  |
                         | household services        |
                         | SQLite owner              |
                         +-------------+-------------+
                                       |
                         trusted household LAN/VPN
                    +------------------+------------------+
                    |                  |                  |
                    v                  v                  v
             Browser kiosk 1    Browser kiosk 2    Parent phone PWA
             display session    display session     PIN admin session
```

The server is the only process that opens the household SQLite database. A
display is never a server and never owns an independent household database.

## 4. Server Architecture

The server should remain TypeScript/Node-based so that most existing domain,
recurrence, Google mapping, validation, and service code can be extracted rather
than rewritten.

Suggested internal boundaries:

```text
server/
  api/              HTTP routes, validation, sessions, display capabilities
  auth/             household PIN and session lifecycle
  db/               schema, migrations, SQLite client
  domain/           people, chores, rewards, lists, meals, devices
  sync/google/      OAuth, calendar discovery, incremental pull, cache status
  events/           server-to-client notifications
  static/           built display and phone web clients
```

The precise directory layout may evolve, but dependencies should point inward:
transport and Google adapters call domain services; domain services do not
depend on HTTP, Electron, or browser code.

### API transport

- Use typed JSON over HTTP for queries and commands.
- Retain Zod validation at the server boundary.
- Reuse the current shared DTOs where their semantics remain valid.
- Replace renderer IPC transport with an HTTP client adapter while keeping UI
  hooks and components stable.
- Use Server-Sent Events (SSE) for invalidation, sync status, chore completion,
  and future celebration events. Bidirectional WebSockets are not required for
  the agreed feature set.
- Namespace the first API as `/api/v1`.
- Provide `/health/live` and `/health/ready` endpoints.

### SQLite operation

- Store the database in a Docker persistent volume, for example
  `/data/openskylight.db`.
- The database file must be on storage local to the Docker host, not an NFS or
  SMB share.
- Enable WAL mode, foreign keys, and a busy timeout at connection startup.
- Run ordered, forward-only migrations before accepting traffic.
- Use transactions for chore completion plus star-ledger changes.
- Shut down gracefully and stop synchronization before closing the database.
- Document a backup procedure that copies a consistent SQLite snapshot.
- A single active server instance is supported initially.

## 5. Data Ownership and Model

### Household-owned data

The central database owns:

- household members and roles;
- Google accounts and selected-calendar mappings;
- cached Google event and recurrence data;
- chores and completion history;
- star ledger and rewards;
- lists and meals;
- household PIN hash and parent sessions;
- registered display devices and their settings;
- Google and service synchronization status.

### Device-specific data

Device settings should be stored centrally against a stable registered device
ID so that the kiosk remains replaceable:

- display name;
- home layout;
- light/dark/auto color-mode preference (separate from person themes);
- sleep and screensaver settings where applicable;
- kiosk UI preferences.

Transient UI state such as the currently selected avatar may remain in the
browser. It must initialize to Family on every fresh application launch.

### Calendar mappings

Each synchronized Google calendar has a nullable `audience_person_id`:

- a person ID maps every event in that calendar to that person;
- `NULL` means Family calendar and supplies no personal association.

An event's effective person IDs are derived, not manually edited:

```text
effective people = mapped calendar person + child names inferred from text
```

Family view includes every active event. A personal view includes an event only
when that person's ID is in the derived set. An empty derived set therefore
means Family-only.

### Exact child-name inference

The matcher examines event title and description. Matching must be deterministic
and covered by unit tests:

- normalize Unicode consistently;
- trim names and collapse repeated whitespace;
- compare case-insensitively;
- require the complete configured child name at text boundaries;
- do not accept substring matches (`Alice` must not match `Alicetown`);
- require the complete phrase for multi-word names;
- strip or normalize Google description markup before matching;
- apply matching only to active `child` records;
- treat duplicate normalized child names as an ambiguous household setup and
  require the parent to make them distinguishable.

Inferred associations should be calculated from current people and event text,
not written back to Google and not stored as permanent manual assignments. A
child rename should therefore change future inference predictably.

## 6. Google Synchronization

The current two-way synchronizer becomes a read-only cache synchronizer.

Keep:

- Google account connection;
- remote calendar discovery and selection;
- sync tokens and incremental pulls;
- etags and remote update timestamps where useful;
- recurring master and exception mapping;
- deletion/cancellation handling;
- retry and visible sync health;
- cached reads during an outage.

Remove:

- display and OpenSkyLight event creation/edit/delete;
- sync outbox;
- Google insert/patch/delete operations;
- last-writer-wins conflict resolution;
- edit-scope workflows;
- private `osl_people` extended-property writes;
- the wall-display event editor and add-event button.

On synchronization failure, retain the last successful cache. The client should
show a subtle status such as `Last synced 18 minutes ago` after a defined stale
threshold. It must not replace usable cached data with an error screen.

OAuth must be redesigned for a headless server and phone-first setup; it cannot
depend on Electron's `shell` or `safeStorage`. The implementation phase must
select a Google-supported headless authorization flow and define encrypted or
operator-managed secret storage before Google integration is considered done.
Plaintext fallback for refresh tokens is not acceptable.

## 7. Authentication and Authorization

### Threat model

The initial product trusts the household LAN and assumes remote connections
arrive through an operator-managed VPN. It must not be directly port-forwarded
to the public Internet.

LAN-only does not mean mutation endpoints are unauthenticated. The primary
authorization boundary protects household administration from children and
other casual LAN users.

### Parent administration

- One household PIN; no usernames, emails, or per-parent accounts.
- Store the PIN using a slow password hash with a per-household salt.
- Apply attempt throttling and temporary backoff.
- Successful PIN entry creates an expiring, HttpOnly, SameSite session.
- Validate request origin and protect state-changing requests against CSRF.
- Changing the PIN invalidates all existing parent sessions.
- Provide an explicit sign-out action.
- A parent session has full household administration capability.

### Displays

- Register each kiosk as a named display device.
- Give it a revocable, device-scoped credential or session.
- Authorize reads required by the display.
- Authorize only `complete today` and `undo today` mutations.
- Enforce the household date and permission on the server, not only in the UI.
- Reject historical and future completion changes from display sessions.
- Profile/avatar selection is a viewing context, not authentication.

## 8. Client Applications

### Shared visual system

The existing display UI is a protected design baseline:

- retain Fraunces and Nunito typography;
- retain the paper/linen palette, color tokens, cards, shadows, and motion;
- retain touch-first calendar, chore, weather, and dashboard components;
- avoid rewriting components merely to change their data transport;
- capture baseline screenshots before material refactoring;
- use visual regression checks for intentional parity.

Electron and standalone Chromium both use Chromium rendering. The renderer can
therefore be extracted with high visual fidelity if fonts, CSS, viewport rules,
and asset loading remain stable.

### Kiosk display

- Primary reference viewport: 2400 x 900.
- Regression viewport: current 1280 x 800 layout.
- Additional responsive check: 1920 x 1080.
- Use a centered, bounded content area on ultra-wide screens.
- Let the visual background fill the whole viewport.
- Keep the maximum content width as a tuneable design token, initially in the
  1600-1800 px range.
- Use bounded responsive typography and spacing rather than scaling the entire
  interface proportionally.
- Preserve at least 48 px touch targets.
- Do not require hover, right-click, or drag-only interactions.
- Keep a tap-based alternative for every essential drag interaction.
- Retain the built-in on-screen keyboard only where short display input remains.

The kiosk starts in Family view. Avatar taps switch to personal views. The
selection remains until manually changed or the web application is launched
again.

### Display content behavior

In personal view:

- calendar views show events derived for the selected person;
- chores show only that person's chores;
- star balance and rewards show that person's information;
- shared weather, meals, lists, news, photos, and timer content remains visible.

All display content is read-only except today's chore completion and undo.
Reward redemption is parent-side only.

### Parent phone application

The parent web application should be responsive and use the same visual language
without attempting to shrink the wall layout onto a phone. It manages:

- household members and roles;
- Google account connection;
- calendar selection and person mapping;
- chores and corrections;
- rewards and star adjustments;
- lists and meals;
- registered displays and device settings;
- layouts where remote layout editing is supported;
- household PIN and sessions;
- sync status and diagnostics.

It does not create or edit calendar events; it should deep-link to Google
Calendar where practical.

## 9. Chores, Rewards, and Celebration Extension

### Completion rules

- A display can complete a chore only when its due date equals the server's
  current household date.
- A display can undo that same day's completion.
- Parent administration can correct historical data.
- Completion and star award are one transaction.
- Undo and removal of the corresponding star entry are one transaction.
- Duplicate completion requests are idempotent.

### Full-screen animation extension seam

Do not build the animation assets in the initial refactor. Establish the seam:

- publish a `chore.completed` event after transaction commit;
- include completion ID, chore, person, stars, timestamp, and initiating device;
- add a dormant `CelebrationOverlay` host to the kiosk shell;
- target the initiating display by default;
- keep animation failure independent from chore completion success.

The seam is now implemented. The follow-up product behavior, managed media, and
person-scoped theme model are defined in
[`personalization-roadmap.md`](personalization-roadmap.md); those additions must
preserve the completion rules and failure isolation above.

## 10. Platform Responsibilities

Moving to browser kiosks removes most application-level OS branching.

The Docker server owns:

- database lifecycle;
- Google synchronization;
- household APIs;
- static web assets;
- scheduled server work.

The Pi/host kiosk configuration owns:

- starting Chromium at boot;
- opening the configured server URL fullscreen;
- hiding browser chrome and the pointer when appropriate;
- display power/DPMS behavior;
- OS updates and browser updates;
- reconnecting after server or network interruption.

OpenSkyLight should provide a documented example kiosk setup, but should not
embed a distribution-specific Linux control layer into the web application.

## 11. Operational Model

The initial container distribution should provide:

- a versioned server image;
- a sample Compose file;
- one persistent `/data` volume;
- explicit listen address, port, household timezone, and Google configuration;
- liveness and readiness health checks;
- structured logs without secrets;
- graceful SIGTERM handling;
- a documented backup and restore procedure;
- a documented upgrade and rollback procedure;
- a warning that the service is LAN/VPN-only.

The household timezone is a server setting and is authoritative for today's
chores, recurrence presentation, and date-sensitive rules. Display browser
timezone differences must not change authorization decisions.

## 12. Implementation Strategy

Use a strangler-style migration. Preserve the current renderer while extracting
domain services and adding an HTTP transport. Do not combine architecture
extraction with a broad visual rewrite.

### Phase 0 - Baselines and guardrails

Objectives:

- Make current behavior and visual appearance measurable.
- Establish a reproducible Linux development baseline.

Work:

- Pin Node to a supported LTS release.
- Add Linux CI for install, typecheck, and unit tests.
- Capture reference screenshots at 1280 x 800 and 2400 x 900.
- Identify CSS/design tokens that constitute the protected visual system.
- Add unit tests for the agreed event-audience rules before changing sync.
- Record the current typed IPC contract and map each operation to its future
  display or parent capability.

Acceptance criteria:

- A clean Linux checkout installs and passes typecheck/tests.
- Reference screenshots are reproducible.
- Audience-rule tests cover mapped calendars, child names, adult names,
  multi-word names, substrings, and Family-only events.

### Phase 1 - Headless server foundation

Objectives:

- Boot existing household services without Electron.
- Establish the clean SQLite server schema.

Work:

- Create the headless server entry point.
- Extract database, people, chore, reward, list, meal, recurrence, and settings
  code away from Electron imports.
- Create forward-only server migrations for a fresh database.
- Enable SQLite WAL, foreign keys, busy timeout, and graceful close.
- Add health endpoints and structured startup logging.
- Add the Dockerfile and development Compose configuration.

Acceptance criteria:

- The container starts with an empty persistent volume.
- Restarting preserves data.
- Only one server process opens the database.
- Domain unit tests run without Electron.

### Phase 2 - Read-only Google cache and audience derivation

Objectives:

- Make Google the only event writer.
- Produce correct Family and personal event feeds.

Work:

- Redesign OAuth for headless, phone-first setup.
- Add Google account and calendar-selection administration services.
- Add Family/person calendar mapping.
- Convert Google sync to incremental pull-only operation.
- Remove outbox and all Google write paths.
- Implement exact child-name inference.
- Derive effective event people when serving event data.
- Preserve cached events and expose stale/sync status.

Acceptance criteria:

- An event moved between Google calendars changes its mapped audience after sync.
- Exact child-name matches add children; adult names and substrings do not.
- Unassigned events appear only in Family view.
- A Google outage leaves the last successful events readable.
- No server endpoint can create, edit, or delete a Google event.
- Google secrets never use a silent plaintext fallback.

### Phase 3 - Typed HTTP API and authorization

Objectives:

- Replace Electron IPC as the application boundary.
- Enforce display and parent capabilities on the server.

Work:

- Define `/api/v1` schemas using shared DTOs and Zod.
- Implement household PIN setup, login, logout, expiry, and invalidation.
- Add throttling and CSRF/origin protections.
- Implement display registration and revocation.
- Enforce read-only display access plus today's chore complete/undo.
- Add SSE invalidation and sync-status delivery.
- Add idempotency for chore toggles.

Acceptance criteria:

- Unauthorized parent mutations fail server-side.
- A display cannot alter events, settings, rewards, old chores, or future chores.
- Changing the PIN invalidates existing parent sessions.
- Multiple displays receive data invalidations from one server.

### Phase 4 - Browser kiosk extraction with visual parity

Objectives:

- Run the existing wall UI as a browser client.
- Preserve its look and touch behavior.

Work:

- Introduce an HTTP implementation behind the existing client hooks.
- Remove the event editor and add-event control.
- Add Family/person audience state and avatar switching.
- Apply personal filtering consistently to calendar, chores, balances, rewards,
  and person-aware home tiles.
- Keep shared widgets unchanged in personal views.
- Enforce Family startup and manual-only switching.
- Add centered ultra-wide layout and bounded scaling.
- Add offline/reconnecting and stale-Google indicators.
- Add the dormant celebration overlay host.

Acceptance criteria:

- Chromium kiosk renders the protected UI with approved visual parity.
- 2400 x 900 is centered and readable without oversized controls.
- 1280 x 800 remains usable.
- No essential action requires a mouse, keyboard, hover, or right-click.
- Restart always opens Family view.

### Phase 5 - Phone-first parent administration

Objectives:

- Make all household configuration practical from a phone.

Work:

- Build responsive PIN login and administration navigation.
- Add people/role management.
- Add Google setup, calendar selection, and mapping.
- Add chore, reward, correction, list, and meal management.
- Add display registration and device-setting management.
- Add sync health and diagnostic views.
- Remove any remaining requirement to enter long credentials on a kiosk.

Acceptance criteria:

- A fresh household can be configured from a phone.
- A parent can manage two displays from the same server session.
- Calendar events cannot be edited from the parent application.
- Administration remains usable without a physical keyboard on a display.

### Phase 6 - Remove obsolete Electron and media features

Objectives:

- Delete superseded platform and feature surface after browser parity exists.

Work:

- Remove camera services, IPC, UI, tests, and saved-layout support.
- Remove BirdNET services, protocols, UI, and tests.
- Remove `ffmpeg-static`, `mpegts.js`, and unused WebSocket dependencies.
- Remove Electron-only updater, window, preload, and kiosk code after equivalent
  browser deployment is validated.
- Remove two-way event edit/outbox code and obsolete tests.
- Sanitize any demo/default layouts that reference removed tiles.
- Rewrite README architecture and development instructions.

Acceptance criteria:

- No camera or BirdNET capability remains.
- The server and browser builds have no Electron runtime dependency.
- Production and development documentation describe the new topology accurately.
- Unit, API, and visual test suites pass.

### Phase 7 - Multi-display and Raspberry Pi deployment validation

Objectives:

- Prove the intended household topology on real hardware.

Work:

- Publish a sample Chromium kiosk service/autostart configuration.
- Test two simultaneous display registrations.
- Test server restart, Wi-Fi interruption, and browser reconnect behavior.
- Validate touch input and the on-screen keyboard on the 2400 x 900 display.
- Validate a 64-bit Raspberry Pi kiosk.
- Tune caching and initial-load performance.
- Document device replacement and revocation.

Acceptance criteria:

- Both displays show the same household state.
- A chore completed on one display is reflected on the other and on the phone.
- Server or network interruption produces a recoverable status, not a broken UI.
- Pi boot reliably enters the kiosk without a physical keyboard or mouse.

### Phase 8 - Operations and release hardening

Objectives:

- Make upgrades and recovery safe for an unattended household service.

Work:

- Add container release automation and version metadata.
- Add migration backup/restore tests.
- Add documented volume backup and restore commands.
- Add dependency and image security checks.
- Add log redaction tests for PINs, tokens, and Google credentials.
- Define supported browser and server-version compatibility.

Acceptance criteria:

- A documented backup can restore a working household instance.
- A failed upgrade has a documented rollback path.
- Secrets do not appear in logs or health responses.
- The LAN/VPN-only security boundary is prominent in deployment docs.

## 13. Test Strategy

Maintain several layers:

- Pure unit tests for recurrence, name inference, audience derivation, chore
  dates, balances, and mapping.
- Database service tests using temporary SQLite databases.
- HTTP contract tests for validation and capabilities.
- Google mapping tests with recorded/synthetic resources, not live credentials.
- Browser component tests for Family/personal filtering.
- Playwright journeys for phone setup and kiosk use.
- Screenshot regression tests at 2400 x 900, 1920 x 1080, and 1280 x 800.
- Docker smoke tests with a persistent volume and restart.
- A real-device checklist for touch and Pi kiosk behavior.

## 14. Explicit Non-goals for the Initial Refactor

- Public Internet exposure without VPN.
- Multi-household or multi-tenant hosting.
- Per-child authentication or email accounts.
- Parent usernames or identity-provider integration.
- Direct event editing in OpenSkyLight.
- Peer replication or multiple active database servers.
- Full offline display mutations while the household server is unavailable.
- Camera, RTSP, or BirdNET integrations.
- Import of legacy standalone application data.
- A visual redesign of the wall display.
- Full-screen chore animation assets beyond the extension seam (subsequent work
  is governed by [`personalization-roadmap.md`](personalization-roadmap.md)).

## 15. First Implementation Milestone

The first milestone should include Phases 0 and 1 only:

1. establish Linux/toolchain and screenshot baselines;
2. add audience-rule tests;
3. extract a headless server with a fresh SQLite schema;
4. run it in Docker with health checks and persistent storage;
5. keep the current Electron application working during extraction.

This creates the new architectural foundation without risking the UI or trying
to change synchronization, transport, authentication, and deployment in one
step.
