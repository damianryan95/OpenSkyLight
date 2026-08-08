# C02 - Remove BirdNET functionality

Status: done
Depends on: K01, K03, K04  
Gate: browser-kiosk parity approved

## Context

Read target architecture sections 2/Removed capabilities and 12/Phase 6.

## Deliverable

Remove BirdNET types, validation, protocols/proxying, service, API/IPC paths,
home tile/picker, tests, scripts, documentation, and stored-layout references.
Audit whether any network/protocol dependencies become unused.

Likely files: BirdNET service, kiosk protocols, shared contracts/home, renderer
home, tests/scripts/docs/package files.

## Acceptance

- No BirdNET UI, proxy, type, or callable route remains.
- Stale BirdNET tiles cannot break a layout.
- Unused dependencies are removed only after an `rg`/dependency audit.
- Remaining weather/RSS network behavior is unaffected.

Verify: `rg` audit, typecheck, unit and browser smoke tests.
