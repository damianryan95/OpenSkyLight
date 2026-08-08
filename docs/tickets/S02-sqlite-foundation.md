# S02 - Establish the fresh SQLite schema

Status: done
Depends on: S01

## Context

Read target architecture sections 4/SQLite operation and 5.

## Deliverable

Create the fresh server schema and forward-only migration runner. Include people,
Google accounts/calendars with nullable audience person, event cache, chores,
ledger/rewards, lists/meals, settings, devices, and auth/session storage. Enable
WAL, foreign keys, busy timeout, and graceful close.

Likely files: `src/server/db/`, database tests.

## Acceptance

- Empty database migrates to the latest version transactionally.
- Re-running migrations is idempotent.
- Calendar audience foreign keys and core uniqueness constraints exist.
- Database is local-volume safe and no legacy import is implemented.

Verify: migration tests, schema constraint tests, typecheck.
