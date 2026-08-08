# G03 - Implement pull-only event caching

Status: done  
Depends on: G02

## Context

Read target architecture section 6 and 12/Phase 2.

## Deliverable

Port Google event mapping into a headless incremental pull synchronizer. Cache
masters, exceptions, cancellations, etags, remote timestamps, and sync tokens.
There must be no insert, patch, delete, outbox, or conflict-resolution path.

Likely files: `src/server/sync/google/`, event cache repository, mapping tests.

## Acceptance

- Initial and incremental pulls converge the cache.
- Remote deletes/cancellations are applied only after successful sync evidence.
- Recurrence behavior retains existing test coverage.
- Network/API failure leaves the previous cache readable.

Verify: synthetic Google resource tests and cache integration tests.
