# G05 - Expose sync health and stale-cache state

Status: done  
Depends on: G03, A01, A05

## Context

Read target architecture sections 6 and 8/Kiosk display.

## Deliverable

Track last attempt, last success, in-progress state, per-calendar errors, and
cache staleness. Expose typed query data and publish changes through the server
event stream. Define and test the stale threshold without hiding cached events.

Likely files: Google scheduler/status service, API DTO/routes, SSE integration.

## Acceptance

- Offline/error state retains cached events.
- Status distinguishes never-synced, fresh, stale, syncing, and failed.
- Secrets and raw Google responses never appear in status payloads.
- Successful recovery clears stale/error presentation state.

Verify: scheduler/status tests and API contract tests.
