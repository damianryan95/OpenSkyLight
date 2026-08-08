# F04 - Inventory and split client capabilities

Status: done  
Depends on: none

## Context

Read target architecture sections 2/Display permissions, 7, and 8.

## Deliverable

Inventory every existing IPC operation and classify it as display-read,
display-chore-write, parent-write, obsolete-event-write, or obsolete-feature.
Propose future `/api/v1` resource groupings and shared DTO ownership without
implementing the HTTP server.

Likely files: add a document under `docs/`; inspect `src/shared/ipc/`, router,
preload, renderer hooks, and companion allowlist.

## Acceptance

- Every current channel has exactly one disposition.
- Display capabilities contain no mutation other than today's chore toggle.
- Camera, BirdNET, and event-write operations are explicitly marked obsolete.
- Proposed boundaries identify DTOs that need semantic changes.

Verify: cross-check the inventory mechanically against the IPC contract keys.
