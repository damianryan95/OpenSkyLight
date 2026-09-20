# OpenSkyLight Refactor Ticket Backlog

These tickets decompose [`target-architecture.md`](../target-architecture.md)
into bounded tasks suitable for small-context agents. The target architecture is
authoritative if a ticket is ambiguous.

## Agent handoff contract

Give an agent one ticket ID and ask it to read only:

1. this README;
2. the named ticket file;
3. the target-architecture sections listed in that ticket;
4. repository files it must inspect to complete the task.

Every delivery should include:

- the implementation and tests in the ticket scope;
- verification results;
- changed-file summary;
- newly discovered risks or follow-up work;
- no unrelated cleanup or visual redesign.

Agents must preserve existing worktree changes, keep the current application
working unless the ticket explicitly removes it, and avoid silently expanding a
ticket. If an acceptance criterion requires an unresolved product decision, the
agent should stop and report it.

## Status convention

New extension tickets may begin as `planned`; change them to `ready` only when
all dependencies are complete. Change status to `in progress`, `blocked`, or
`done` as work proceeds. A ticket is not done until its verification and
acceptance criteria pass.

## Dependency order

```text
F01 --------> S01 ---> S02 ---> S03 -----------+
                  |       +---> S04 ---> A04 --+---> K01
F04 --------------+       +---> S05 -----------+      |
                  +---> A01 ---> A02 ---> P01 --+      +--> K02/K03/K04/K05/K06
                              +-> A03 ----------+      |
                              +-> A05 ----------+      +--> P02/P03/P04/P05

F03 ---> G04 <--- G03 <--- G02 <--- G01
                    +----> G05

F02 -------------------------------------------> K04

Kiosk + phone parity ---> C01/C02/C03 ---> C04 ---> O04
                                        
S06 ---> O03       Kiosk parity ---> O01/O02
```

## Tickets

### Foundation

- [F01 - Pin the Linux toolchain](F01-linux-toolchain.md)
- [F02 - Capture visual baselines](F02-visual-baselines.md)
- [F03 - Implement pure audience derivation](F03-audience-derivation.md)
- [F04 - Inventory and split client capabilities](F04-capability-inventory.md)

### Headless server

- [S01 - Create the headless server skeleton](S01-server-skeleton.md)
- [S02 - Establish the fresh SQLite schema](S02-sqlite-foundation.md)
- [S03 - Extract people and household settings](S03-people-settings.md)
- [S04 - Extract chores and rewards](S04-chores-rewards.md)
- [S05 - Extract lists and meals](S05-lists-meals.md)
- [S06 - Add Docker development packaging](S06-docker-dev.md)

### Google Calendar

- [G01 - Resolve the headless Google OAuth flow](G01-google-oauth-spike.md)
- [G02 - Implement account and calendar discovery](G02-google-calendar-discovery.md)
- [G03 - Implement pull-only event caching](G03-google-pull-cache.md)
- [G04 - Integrate effective event audiences](G04-event-feeds.md)
- [G05 - Expose sync health and stale-cache state](G05-sync-health.md)

### HTTP API and authorization

- [A01 - Create the typed HTTP API foundation](A01-http-foundation.md)
- [A02 - Implement household PIN sessions](A02-pin-sessions.md)
- [A03 - Implement display registration and capabilities](A03-display-auth.md)
- [A04 - Implement safe display chore commands](A04-display-chores.md)
- [A05 - Implement the server event stream](A05-event-stream.md)

### Browser kiosk

- [K01 - Extract the renderer into a browser client](K01-browser-client.md)
- [K02 - Add Family and personal viewing contexts](K02-viewing-context.md)
- [K03 - Enforce the read-only display experience](K03-readonly-display.md)
- [K04 - Preserve UI parity and add centered scaling](K04-visual-parity.md)
- [K05 - Add reconnect and stale-data states](K05-connectivity-ui.md)
- [K06 - Add the celebration animation seam](K06-celebration-seam.md)

### Parent phone administration

- [P01 - Build the phone admin shell and PIN login](P01-admin-shell.md)
- [P02 - Build people and calendar administration](P02-people-calendars.md)
- [P03 - Build chore and reward administration](P03-chores-rewards-admin.md)
- [P04 - Build list and meal administration](P04-lists-meals-admin.md)
- [P05 - Build display and diagnostics administration](P05-devices-diagnostics.md)

### Cleanup

- [C01 - Remove camera functionality](C01-remove-camera.md)
- [C02 - Remove BirdNET functionality](C02-remove-birdnet.md)
- [C03 - Remove two-way event editing and sync](C03-remove-event-writes.md)
- [C04 - Retire Electron and update project documentation](C04-retire-electron.md)

### Deployment and operations

- [O01 - Validate multi-display behavior](O01-multi-display.md)
- [O02 - Document and validate Raspberry Pi kiosk deployment](O02-pi-kiosk.md)
- [O03 - Add backup, restore, and container release support](O03-operations.md)
- [O04 - Perform final security and release hardening](O04-release-hardening.md)

### Person themes and celebrations

Product and technical direction: [`personalization-roadmap.md`](../personalization-roadmap.md).

- [PE01 - Validate the personalization experience](PE01-personalization-prototype.md)
- [PE02 - Add person personalization contracts and persistence](PE02-personalization-domain.md)
- [PE03 - Build the context-aware theme engine](PE03-theme-runtime.md)
- [PE04 - Add parent theme assignment](PE04-theme-admin.md)
- [PE05 - Add managed celebration media](PE05-celebration-media.md)
- [PE06 - Add parent celebration setup and preview](PE06-celebration-admin.md)
- [PE07 - Build the chore celebration renderer](PE07-celebration-runtime.md)
- [PE08 - Create the starter personalization packs](PE08-starter-packs.md)
- [PE09 - Add the bounded custom theme composer](PE09-theme-composer.md)
- [PE10 - Harden and release personalization](PE10-personalization-hardening.md)

Only PE01 is initially ready. Follow the dependency graph in the personalization
roadmap; do not use the older refactor wave numbers for these extension tickets.

### Phone-first platform

Product and technical direction: [`phone-first-roadmap.md`](../phone-first-roadmap.md).

- [N01 - Audit functionality removed from the upstream project](N01-removed-functionality-audit.md)
- [N13 - Retire the Google OAuth layer and de-Google the event schema](N13-retire-google-oauth-layer.md)
- [N14 - CalDAV and ICS calendar source](N14-caldav-ics-source.md)
- [N05 - Phone-native calendar connector](N05-native-calendar-connector-adr.md)
- [N06 - Bidirectional calendar sync](N06-bidirectional-calendar-sync-adr.md)
- [N02 - Raspberry Pi first-boot Wi-Fi access point pairing](N02-pi-wifi-ap-pairing.md)
- [N03 - Local network name for the server](N03-local-network-name.md)
- [N04 - Phone-first setup wizard](N04-phone-first-setup-wizard.md)
- [N07 - Self-hosted remote access via WireGuard](N07-remote-access-adr.md)
- [N08 - Local USB backup target](N08-local-usb-backup.md)
- [N09 - Personal cloud backup target](N09-personal-cloud-backup.md)
- [N10 - SD card photo storage (deferred)](N10-sd-card-photo-storage.md)
- [N11 - Device access hardening (deferred)](N11-device-access-hardening.md)
- [N12 - Power management (deferred)](N12-power-management.md)
- [N15 - On-screen calendar editing](N15-on-screen-calendar-editing.md)

N01 and N13 are ready. The calendar direction is set by
[ADR 0002](../adr/0002-provider-agnostic-calendar-access.md), which supersedes
ADR 0001 and removes the Google OAuth layer; the remote-access direction is set
by [ADR 0003](../adr/0003-self-hosted-remote-access.md). Treat `G01`–`G05` as
historical rather than current architecture. N02, N04, and N12 depend on O02's
real-Pi hardware evidence; Phase 1 (N13, N14, N05) deliberately does not, so
calendar work can proceed while hardware is unavailable. Follow the dependency
graph and phasing in the phone-first roadmap; do not use the older refactor or
personalization wave numbers for these tickets.

## Suggested parallel waves

- Wave 1: F01, F02, F03, F04, G01.
- Wave 2: S01, then S02 and A01.
- Wave 3: S03, S04, S05, A02, A03, A05, G02.
- Wave 4: S06, A04, G03, then G04 and G05.
- Wave 5: K01 and P01, then the remaining K and P tickets where file overlap
  permits.
- Wave 6: C01, C02, and C03 after browser/phone parity; then C04.
- Wave 7: O01, O02, O03; finish with O04.
- Wave 8 (calendar independence, no hardware dependency): N01 and N13
  immediately; then N14 and N05 in parallel once N13's seam lands; N06 after
  both.
- Wave 9 (phone-first onboarding, needs O02): N02 and N03, then N04; O04
  alongside.
- Wave 10: N07, then N08 and N09.
- Wave 11 (deferred "sellable product" phase): N10, N11, N12.

Do not run tickets concurrently when their likely-file lists overlap unless the
agents coordinate ownership first.

## Delegation prompt template

```text
Implement ticket <ID> from docs/tickets/<ticket-file>.md.

Read docs/tickets/README.md, that ticket, and only the target-architecture
sections named by the ticket before inspecting the relevant code. Stay inside
the ticket scope, preserve unrelated worktree changes, implement its tests, and
run its verification. Do not begin dependent or follow-up tickets. In your
handoff, report changed files, verification results, risks, and any newly
discovered dependency. Mark the ticket done only if every acceptance criterion
passes; otherwise report it as blocked with concrete evidence.
```

For a `PE` ticket, also read `docs/personalization-roadmap.md` sections named by
the ticket. That roadmap is authoritative for personalization-specific product
decisions.
