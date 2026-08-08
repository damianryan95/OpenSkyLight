# A04 - Implement safe display chore commands

Status: done  
Depends on: A03, S04

## Context

Read target architecture sections 7/Displays and 9/Completion rules.

## Deliverable

Expose display-authorized complete and undo commands. The server—not the client—
must use the household timezone to require the current date. Make retries
idempotent and publish a post-commit completion event for A05/K06 consumers.

Likely files: chore API routes, command service, authorization/tests.

## Acceptance

- Today complete/undo succeeds for display sessions.
- Past/future dates and other mutations are rejected.
- Duplicate requests cannot double-award stars.
- Event publication occurs only after a committed completion.

Verify: timezone-boundary, idempotency, rollback, and authorization tests.
