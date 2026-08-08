# S01 - Create the headless server skeleton

Status: done
Depends on: F01, F04

## Context

Read target architecture sections 3, 4, and 12/Phase 1.

## Deliverable

Add a TypeScript/Node server entry point and build/dev scripts that run without
Electron. Establish module boundaries for API, auth, database, domain, Google
sync, and server events. Initially expose only process lifecycle and a minimal
live endpoint; do not migrate UI traffic yet.

Likely files: new `src/server/`, TypeScript/build configs, `package.json`.

## Acceptance

- Server starts and stops without importing Electron.
- Current Electron dev/build path still works.
- SIGTERM is handled cleanly.
- Structure avoids duplicating shared domain code.

Verify: server build, start/health smoke test, existing typecheck/tests.
