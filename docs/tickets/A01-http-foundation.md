# A01 - Create the typed HTTP API foundation

Status: done  
Depends on: S01, F04

## Context

Read target architecture sections 4/API transport and 7.

## Deliverable

Choose and establish the server HTTP routing layer under `/api/v1`, consistent
error envelopes, Zod request/response validation, typed client generation or
shared contract inference, JSON limits, and live/ready routes. Add no broad
resource API yet.

Likely files: `src/server/api/`, `src/shared/`, API tests.

## Acceptance

- Invalid input yields stable typed errors.
- Payload/body limits are explicit.
- Domain services do not import the HTTP framework.
- Browser-safe typed client code has no Node/Electron dependency.

Verify: API contract tests, server build, web typecheck.
