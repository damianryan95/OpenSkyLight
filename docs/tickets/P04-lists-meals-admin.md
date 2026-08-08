# P04 - Build list and meal administration

Status: done  
Depends on: P01, S05

## Context

Read target architecture sections 8/Display content behavior and Parent phone
application.

## Deliverable

Add responsive parent flows for lists/items and meal planning. The phone can
mutate; kiosks consume read-only queries. Preserve current semantics unless a
separate product decision is required.

Likely files: admin pages/hooks, parent API routes, DTOs/tests.

## Acceptance

- Parent can manage lists and meals comfortably on a phone.
- Kiosk query DTOs contain no accidental mutation capability.
- Multi-client invalidation updates displays after phone changes.
- Parent session is required for every command.

Verify: API tests and phone-to-display E2E update journey.
