# N10 - SD card photo storage (deferred)

Status: planned
Depends on: N08, N09

## Context

Read `docs/personalization-roadmap.md` section 4 (existing media-storage
conventions) and the finished `N08`/`N09` ticket files for the backup
boundary this must respect. Per the source notes, this belongs to the later
"project considered sellable" phase — do not schedule before Phase 3 of
`docs/phone-first-roadmap.md` is stable.

## Deliverable

A local-only photo storage area on the Pi's SD card (for a screensaver/photo
feature), explicitly and permanently excluded from every backup path (`N08`,
`N09`) per the source notes: "photos are never backed up." Full scoping
(storage layout, size limits, eviction policy) is deferred to when this
ticket is picked up.

Likely files: to be determined at scoping time.

## Acceptance

- Photos are never present in any backup snapshot, local or cloud.
- SD card storage exhaustion is handled without affecting core services
  (calendar, chores, celebrations).

Verify: to be determined at scoping time; must include a negative test
confirming photo data is absent from a backup snapshot.
