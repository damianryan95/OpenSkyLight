# O03 - Add backup, restore, and container release support

Status: done  
Depends on: S06, S02

## Context

Read target architecture sections 4/SQLite operation, 11, and 12/Phase 8.

## Deliverable

Document and automate consistent SQLite backup/restore, graceful upgrade,
versioned container image build, migration-before-ready behavior, rollback
constraints, and volume ownership. Keep deployment single-instance.

Likely files: operational scripts/docs, CI workflow, container metadata/tests.

## Acceptance

- A backup restores into a clean volume and passes readiness.
- Container versions are immutable and identifiable in diagnostics.
- Failed migration never reports ready or corrupts the pre-upgrade backup.
- Single-active-server limitation is prominent.

Verify: automated backup/restore and upgrade smoke tests.
