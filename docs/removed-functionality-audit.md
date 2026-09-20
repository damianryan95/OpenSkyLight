# Removed functionality audit

Ticket: [`N01`](tickets/N01-removed-functionality-audit.md)
Compared: upstream `lowerygt/OpenSkyLight` at tag `v0.8.0` (the fork point) against this fork's `main`
Date: 2026-09-20

This is a decision aid, not a plan. Nothing here is scheduled. Tick what should
come back and it becomes its own ticket.

Lineage matters when reading this: `lowerygt` built an Electron desktop app →
`bradis86` re-platformed it into a headless LAN server → this fork continued
from there. Most of what is missing went during that re-platforming.

## 1. Removed deliberately, with a ticket

| Feature | Ticket | Notes |
| --- | --- | --- |
| **IP camera tiles (RTSP)** | `C01` | Live `rtsp://` camera streams on the home screen. No trace remains in the codebase. |
| **Bird detections (BirdNET-Go)** | `C02` | Tile pointed at a BirdNET-Go instance. No trace remains. |
| **Two-way Google Calendar sync** | `C03` | Kiosk could create/edit/delete events. Deliberately reduced to read-only. |
| **Google Calendar integration entirely** | `N13` | Replaced by provider-agnostic CalDAV/ICS (`N14`) per ADR 0002 — a deliberate widening, not a loss. |
| **Local calendars with on-screen event create/edit/delete** | `C03`, `K03` | The kiosk is now strictly read-only apart from ticking today's chores. **Selected to return** as [`N15`](tickets/N15-on-screen-calendar-editing.md), once `N06` provides a write path. |

## 2. Lost when Electron was retired (`C04`)

These depended on a desktop runtime and have no headless equivalent:

- **Auto-update from GitHub Releases** — the app updated itself in place.
- **Windows installers / packaged builds** — replaced by a container image.
- **Launch-on-startup, single-instance lock, crash auto-relaunch** — now the
  OS/container runtime's job (`restart: unless-stopped`).
- **QR-code phone pairing for the companion app** — the display served the
  companion itself on port 8420. Replaced by `/admin/` on the server, with
  display enrolment links instead.

## 3. Present in the UI but non-functional — since fixed

These were never formally removed. Their interface still rendered and a parent
could still reach them, but the server had no handler, so they failed or
silently returned nothing. Found by diffing the 55 declared IPC channels
against the 20 the server actually served.

**All five were restored on 2026-09-20 rather than hidden.**

| Feature | Was | Now |
| --- | --- | --- |
| **News / RSS tile** | Offered in the "Add tile" sheet but `rss:getFeed` had no handler, so it could never load. | Upstream's RSS service ported to `src/server/domain/rss.ts`. Fetched server-side, so no display reaches the open internet and one fetch serves every screen. Stale headlines are served over an error. |
| **Photo screensaver** | `screensaver:listPhotos` returned a hardcoded `[]`. No photo source existed. | Rebuilt on the `PE05` media pipeline: photos upload from the phone under **Planning → Family photos** and are served to displays with the same validation and credential checks as celebration media. Needed JPEG support, which celebrations never did. |
| **Weather city search** | `weather:searchCity` had no handler, so the picker could not resolve a location. | Open-Meteo geocoding, fetched by the server. |
| **Kiosk sync status row** | `sync:getStatus` returned a hardcoded `{ state: 'idle' }`. | Reports the real per-calendar state. |
| **ICS feed subscription from the kiosk** | `IcsSection` rendered and called the unhandled `ics:add`. | **Deliberately not restored as a form.** Calendar sources are managed on the phone (`N14`) and a display is read-only (`K03`); the section now lists what is connected and points at the phone. |

The other 30 unhandled channels are **correct** — they are write operations
(`chores:create`, `lists:delete`, `people:update`, `rewards:grant`, …) that the
read-only display guarantee in `K03` is supposed to refuse. The router's
`default` case rejects them with "This display capability is read-only". No
action needed there.

## 4. Changed rather than removed

- **Parental PIN lock** → household PIN sessions (`A02`), now enforced
  server-side rather than in an Electron main process.
- **Phone companion app** → the `/admin/` companion web app (`P01`–`P05`),
  considerably more capable than the original paired-phone editor.
- **ICS feed subscriptions** → re-implemented server-side in `N14`, alongside
  CalDAV. Broader than upstream's read-only conditional-GET version.
- **Per-person filter chips** → the `family | person:<id>` viewing context
  (`K02`), which also drives personalization.

## 5. Intact

Week / Day / Month / Agenda calendar views · family member profiles and colours
· recurring event display · weather header via Open-Meteo · chores and routines
· star rewards ledger · custom lists · meal planning · sleep schedule ·
dark mode that follows the sun · customizable draggable/resizable tile
dashboard · on-screen keyboard · the warm paper-planner visual design · timer
tile.

## 6. Where this landed

Nothing in section 1 or 2 was an accident — those were deliberate calls, and
the Electron losses are the price of the container model this fork wanted.

Section 3 was different: loose ends from the re-platforming rather than
decisions. A parent could add a News tile and get one that never loaded, which
is worse than the feature being absent, because the product was advertising
something it could not do. Those were fixed rather than hidden.

One item from section 1 has since been selected to return:
**on-screen calendar editing**, as [`N15`](tickets/N15-on-screen-calendar-editing.md),
scheduled behind `N06` because writing an event from a wall display only means
something once the change reaches the calendar it came from.

The rest of section 1 and 2 stands as the record of what could return later.
Each would be its own ticket.
