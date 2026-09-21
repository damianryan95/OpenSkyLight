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
The server image ships the kiosk bundle.

Hardware note (2026-09-22): this ticket was written when a Raspberry Pi 5 was
the assumed target. **The supported device is now open and unlikely to be a
Raspberry Pi** — see `docs/phone-first-roadmap.md` section 3a and `N16`. Read
every mention of "Pi" below as "the supported kiosk device".

A Raspberry Pi 3B+ is in use as a **test rig only**: `home-server` hosts the
application and the Pi runs Chromium. It has 1GB of RAM and cannot host the
server and a browser together, so it is not a candidate for the final device
and results from it do not close this ticket.

The checklist itself is device-agnostic and still applies. Complete it against
whatever device is chosen; partial results from the test rig are useful
evidence for the kiosk half and should be recorded as such, clearly labelled
with the hardware they came from.
