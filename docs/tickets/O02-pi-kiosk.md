# O02 - Document and validate Raspberry Pi kiosk deployment

Status: blocked  
Depends on: K04, K05, S06

## Context

Read target architecture sections 10 and 12/Phase 7.

## Deliverable

Provide one supported 64-bit Raspberry Pi Chromium kiosk setup with boot
autostart, fullscreen flags, pointer handling, reconnect behavior, and host-level
display power guidance. Validate on real hardware; do not add Pi-specific UI
forks.

Likely files: deployment docs and example service/session configuration.

## Acceptance

- Pi boots to the configured server URL without keyboard/mouse.
- Touch works at the target display and UI remains centered/responsive.
- Browser/server restart recovers automatically.
- OS ownership of DPMS and updates is explicit.

Verify: real-device checklist with versions and observed limitations.

Implementation note (2026-08-04): example X11 Chromium autostart configuration
and a real-device checklist are in
[`docs/deployment/raspberry-pi-kiosk.md`](../deployment/raspberry-pi-kiosk.md).
This ticket remains blocked pending real Pi validation on the supported
hardware. The server image ships the kiosk bundle.
