# N12 - Power management (deferred)

Status: planned
Depends on: O02

## Context

Read target-architecture sections 10 and 12/Phase 7 and
`docs/tickets/O02-pi-kiosk.md`. Per the source notes, this belongs to the
later "project considered sellable" phase.

## Deliverable

Software-triggered reboot/shutdown/sleep for the Pi from parent
administration, plus optional support for a hardwired button or USB switch
performing the same actions at the OS level. Per the source notes: "Power
off, reboot etc must be mainly software... but allow for hardwired
button/usb switch to also conduct a reboot/sleep/power off."

Likely files: to be determined at scoping time; likely a privileged
host-level helper the server can invoke, plus a GPIO/USB input listener for
the optional physical control.

## Acceptance

- A parent can reboot or power off the display from the phone without SSH.
- An optional physical control (button/USB switch) performs the same
  reboot/sleep/power-off actions.
- A failed or interrupted shutdown does not corrupt the SQLite database (WAL
  checkpoint/flush is handled before power-off).

Verify: real-device checklist alongside `O02`'s; power-cycle-during-write
fault injection against the database.
