# O01 - Validate multi-display behavior

Status: done
Depends on: K02, K03, K05, K06, P05, A04

## Context

Read target architecture sections 3 and 12/Phase 7.

## Deliverable

Create automated and manual tests with two registered displays plus one parent
client. Cover cross-client invalidation, chore completion/idempotency, targeted
celebration placeholder, revocation, server restart, and transient network loss.

Likely files: integration/E2E harnesses, test fixtures, operational checklist.

## Acceptance

- Both displays converge on the same household state.
- One chore completion awards once and updates every client.
- Celebration targets only the initiating display.
- Revoked/reconnecting clients behave predictably.

Verify: repeatable multi-client E2E suite and documented manual run.
