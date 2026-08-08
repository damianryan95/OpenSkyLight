# K01 - Extract the renderer into a browser client

Status: done  
Depends on: A01, A03, A05, S03, S04, S05, G04

## Context

Read target architecture sections 8/Shared visual system, 8/Kiosk display, and
12/Phase 4.

## Deliverable

Build the existing React renderer as a standalone browser application served by
the server. Add an HTTP/SSE transport behind the existing hooks while minimizing
component changes. Establish display registration/bootstrap handling. Keep the
Electron renderer functional during this ticket.

Likely files: renderer API client/hooks, Vite configs, server static hosting.

## Acceptance

- The same core UI runs in ordinary Chromium without Electron preload globals.
- HTTP/SSE transport is typed and query invalidation works.
- Electron and browser paths do not fork visual components.
- No intentional visual changes are included.

Verify: browser build, Electron build, typecheck, browser smoke test.

## Implementation note (2026-08-02)

The standalone Vite bundle uses the same visual components as Electron. Its
browser transport selects a registered-display credential, reads the core
display model through a strictly whitelisted compatibility bridge, and consumes
authenticated SSE via `fetch` so credentials never enter an event-stream URL.
The bridge rejects all legacy parent mutations; only the already-authorized
today chore complete/undo commands are available to a display.

Verified with `npm run build:kiosk`, Electron `npm run build`, server build,
typecheck, the display-read unit tests, and a real Google Chrome smoke run:
`OSL_CHROMIUM_PATH=/usr/bin/google-chrome-stable npm run test:kiosk-browser`.
