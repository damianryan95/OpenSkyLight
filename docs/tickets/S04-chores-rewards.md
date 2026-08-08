# S04 - Extract chores and rewards

Status: done  
Depends on: S02

## Context

Read target architecture sections 8/Display content behavior and 9.

## Deliverable

Port chore recurrence, completion, star ledger, rewards, redemptions, and parent
correction services to the headless domain layer. Make complete/undo idempotent
and transactionally couple completion rows with ledger entries. Do not add HTTP
or animations.

Likely files: `src/server/domain/`, reused recurrence modules, service tests.

## Acceptance

- Completing twice awards stars once.
- Undo removes only the corresponding award.
- Parent corrections preserve ledger integrity.
- Date authorization is exposed as a domain command parameter for A04.

Verify: focused service tests, recurrence tests, typecheck.
