# S05 - Extract lists and meals

Status: done  
Depends on: S02

## Context

Read target architecture sections 5 and 8/Parent phone application.

## Deliverable

Port list/list-item and meal-plan services to the headless domain layer. Preserve
current behavior and DTO semantics where reasonable. Display use will be
read-only; parent commands remain mutable.

Likely files: `src/server/domain/`, shared DTOs, service tests.

## Acceptance

- List and meal query/command services run without Electron or HTTP.
- Soft deletion/order behavior is explicit and tested.
- The service API separates reads from parent-only commands.
- No UI changes are included.

Verify: focused service tests and typecheck.
