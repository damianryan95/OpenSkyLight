# A03 - Implement display registration and capabilities

Status: done  
Depends on: A01, A02, S02

## Context

Read target architecture sections 5/Device-specific data and 7/Displays.

## Deliverable

Implement parent-approved display registration, named stable device IDs,
revocable device credentials/sessions, and server middleware for display-read
versus parent capabilities. Store device settings centrally.

Likely files: server auth/devices domain, API routes, schema/DTOs, tests.

## Acceptance

- Unregistered or revoked displays cannot read household data.
- Display sessions cannot call parent mutations.
- Parent can list, rename, configure, and revoke displays.
- Credential material is not exposed in logs or normal query DTOs.

Verify: capability matrix API tests and revocation tests.
