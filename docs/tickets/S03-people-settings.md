# S03 - Extract people and household settings

Status: done  
Depends on: S02

## Context

Read target architecture sections 5 and 11.

## Deliverable

Implement Electron-free server services for household members, roles, ordering,
household timezone, and other genuinely household-wide settings. Enforce unique
normalized names required by audience matching. Keep device settings out of the
household settings service.

Likely files: `src/server/domain/`, shared DTOs, service tests.

## Acceptance

- Everyone can have a personal view; role affects name inference only.
- Ambiguous normalized names are rejected with a useful error.
- Household timezone is required and validated.
- Services have no HTTP or Electron dependency.

Verify: service tests and typecheck.
