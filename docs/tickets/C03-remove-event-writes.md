# C03 - Remove two-way event editing and sync

Status: done  
Depends on: G03, K03, P02  
Gate: Google pull-only synchronization validated successfully

## Context

Read target architecture section 6 and 12/Phase 6.

## Deliverable

Delete legacy event create/update/delete services and routes, outbox worker,
Google push mapping, edit-scope DTOs, editor UI, add-event controls, conflict
notifications, and obsolete tests. Preserve read mapping, recurrence expansion,
and cached occurrence queries.

Likely files: main services/sync/router, shared contracts/types, renderer calendar,
tests/scripts/schema/migrations where safely removable.

## Acceptance

- No OpenSkyLight client or API can mutate Google events.
- No outbox worker starts or table is required by the fresh server.
- Read-only recurrence and cancellation tests still pass.
- `osl_people` writes are gone.

Verify: route/`rg` audit, typecheck, unit/API/browser tests.
