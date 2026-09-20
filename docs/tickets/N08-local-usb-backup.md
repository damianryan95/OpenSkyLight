# N08 - Local USB backup target

Status: planned
Depends on: O03

## Context

Read `docs/tickets/O03-operations.md` and `docs/deployment/operations.md`.
This ticket extends the existing backup CLI; it does not replace it.

## Deliverable

Extend the existing online-backup command
(`node out/server/operations-cli.js backup ...`) with a
scheduled or parent-triggerable target that writes to a USB device mounted on
the Pi, alongside — not instead of — the existing manual `docker run ...
backup` flow documented in `README.md`. Detect a missing, unwritable, or full
USB device safely; never corrupt the primary volume or block normal server
operation on a backup failure.

Likely files: `src/server/operations*.ts`, `scripts/`, deployment docs.

## Acceptance

- A scheduled backup lands a restorable snapshot on an attached USB device.
- A missing or unwritable device produces a visible, non-fatal diagnostic
  (surfaced in parent administration) instead of a silent failure or a
  crashed server process.
- Restoring from a USB-backed snapshot follows the same restore procedure as
  an existing manual backup.

Verify: automated backup-to-mounted-path test; manual USB removal and
full-disk fault injection.
