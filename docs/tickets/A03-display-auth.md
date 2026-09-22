# A03 - Implement display registration and capabilities

Status: done (enrolment ceremony superseded)  
Depends on: A01, A02, S02

> **The ceremony here is superseded by
> [ADR 0006](../adr/0006-screen-initiated-pairing.md).** The server model below
> is still current and still correct — named displays, revocable credentials,
> display-read versus parent capabilities, credentials never in a DTO. What
> changed is how a credential reaches a screen: the fragment enrolment link
> (`/#displayCredential=…`) is replaced by the screen displaying a QR that a
> parent's phone scans. Build enrolment from
> [`N18`](N18-screen-qr-enrolment.md), not from this ticket.

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
