# N02 - Raspberry Pi first-boot Wi-Fi access point pairing

Status: planned
Depends on: O02

## Context

Read `docs/deployment/raspberry-pi-kiosk.md` and target-architecture sections
10 and 12/Phase 7. Read `docs/tickets/O02-pi-kiosk.md` — this ticket extends
that hardware-validated deployment, it does not replace it.

## Deliverable

On first boot with no known network configured, the Pi image broadcasts a
local Wi-Fi access point (SSID unique per device; WPA2 passphrase shown on a
first-boot screen or printed label) that a parent's phone can join to hand
the Pi its real household Wi-Fi credentials — entirely from the phone, with
no keyboard, monitor, or SSH. If the supplied credentials fail to associate,
the Pi must fall back to AP mode again rather than becoming unreachable.

Likely files: `deployment/raspberry-pi/*`, a provisioning HTTP endpoint bound
only to the AP interface, a first-boot systemd unit.

## Acceptance

- A factory Pi image joins a household network from a phone with no other
  input devices attached.
- Wrong, expired, or unreachable Wi-Fi credentials fall back to AP mode
  without bricking the device.
- The provisioning endpoint is unreachable once the device holds a household
  Wi-Fi credential (no standing open port on the LAN interface).

Verify: real-device checklist with the same evidence bar as `O02`; adversarial
test of wrong password, hidden SSID, and repeated AP fallback.
