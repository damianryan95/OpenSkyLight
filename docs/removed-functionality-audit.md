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

## 3. Present in the UI but non-functional

**This is the part worth your attention.** These features were never formally
removed. Their interface still renders and a parent can still reach them, but
the server has no handler, so they fail or silently return nothing. Found by
diffing the 55 declared IPC channels against the 20 the server actually serves.

| Feature | What happens now | Where |
| --- | --- | --- |
| **News / RSS tile** | Still offered in the "Add tile" sheet. Calls `rss:getFeed`, which no server route handles, so the tile can never load. | `tiles.tsx:361` |
| **Photo screensaver** | `screensaver:listPhotos` returns a hardcoded `[]`; `screensaver:pickFolder` is unhandled. The photo tile and screensaver have no photo source at all. | `router.ts:570` |
| **ICS feed subscription from the kiosk** | The `IcsSection` still renders in kiosk settings and calls `ics:add`, which is unhandled. *(Note: ICS itself works — `N14` added it on the parent phone. Only this kiosk-side entry point is dead.)* | `SettingsSheet.tsx:322` |
| **Weather city search** | `weather:searchCity` is unhandled, so the city picker cannot resolve a location. Weather itself works once a location is set in `/admin/`. | `hooks.ts:247` |
| **Kiosk sync status row** | `sync:getStatus` returns a hardcoded `{ state: 'idle' }` rather than real sync health, so kiosk settings reports fiction while the connectivity pill reports the truth. | `router.ts:577` |

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

## 6. Suggested reading of this

Nothing in section 1 or 2 looks like an accident — those were deliberate calls,
and the Electron losses are the price of the container model you wanted.

**Section 3 is different.** Those are not decisions anyone made; they are loose
ends from the re-platforming. A parent can add a News tile today and get a tile
that never loads. That is worse than the feature being absent, because the
product is advertising something it cannot do. Whatever you decide about
restoring the features themselves, the dead entry points should either be wired
up or taken out of the UI.

The cheapest coherent option is to hide the unreachable entry points (News tile
from the add sheet, ICS and weather-search sections from kiosk settings,
screensaver photo picker) and let the audit stand as the record of what could
return later. Restoring any of them is separate work with its own ticket.
