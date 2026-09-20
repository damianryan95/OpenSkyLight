# N09 - Personal cloud backup target

Status: planned
Depends on: N08

## Context

Read `docs/tickets/O03-operations.md` and `N08-local-usb-backup.md` (read the
finished N08 ticket file once it exists, for the snapshot format it produces).

## Deliverable

Let a parent optionally point backups at their own cloud storage account
(explicitly not an OpenSkyLight-operated service) from the phone, reusing the
same snapshot format `N08` produces. Scope strictly to settings, household
configuration, and calendar-cache data, per the source notes ("Only for core
services, settings and calendar details.. photos etc will not be backed up").

Likely files: companion settings UI, a server backup-destination adapter
interface.

## Acceptance

- A parent can connect and disconnect their own cloud storage account for
  backups directly from the phone.
- Disabling cloud backup leaves local/USB backup (`N08`) fully functional and
  unaffected.
- No OpenSkyLight-operated intermediary service ever holds a copy of the
  backup; credentials and data flow only between the household's device and
  the household's own cloud account.
- Photos/media are never included in this backup path.

Verify: connect/disconnect E2E; a network trace or code-path review
confirming backup bytes only transit the user-owned cloud endpoint.
