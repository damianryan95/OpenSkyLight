# C01 - Remove camera functionality

Status: done
Depends on: K01, K03, K04  
Gate: browser-kiosk parity approved

## Context

Read target architecture sections 2/Removed capabilities and 12/Phase 6.

## Deliverable

Remove camera types, schemas, IPC/API paths, services, ffmpeg spawning, WebSocket
streaming, renderer tiles/pickers/settings, tests, scripts, documentation, and
dependencies. Sanitize default or saved layouts so stale camera tiles are safe.

Likely files: camera service/args, main/router/preload, shared home/types,
renderer home, package files, tests/scripts/docs.

## Acceptance

- No camera UI or callable channel remains.
- `ffmpeg-static` and `mpegts.js` are absent.
- Stale camera layout data is ignored or removed safely.
- Non-camera tests/builds pass.

Verify: `rg` audit, dependency tree, typecheck, unit and browser smoke tests.
