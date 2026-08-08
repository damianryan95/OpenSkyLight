# P03 - Build chore and reward administration

Status: done  
Depends on: P01, S04

## Context

Read target architecture sections 8/Parent phone application and 9.

## Deliverable

Add phone management for chore definitions/schedules/routines, rewards, star
adjustments, redemption or grant workflows retained by product scope, and
historical chore corrections. Display-side permissions are out of scope.

Likely files: admin pages/hooks, parent API routes, domain DTOs/tests.

## Acceptance

- Parent can create/update/archive chores and rewards from a phone.
- Historical correction preserves ledger integrity.
- Forms remain usable without desktop-sized controls.
- Mutations require a parent session.

Verify: service/API tests and phone E2E for a recurring chore and correction.
