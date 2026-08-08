# A05 - Implement the server event stream

Status: done  
Depends on: A01

## Context

Read target architecture sections 4/API transport and 9/Future full-screen
animation.

## Deliverable

Implement authenticated SSE connections, event IDs, heartbeats, reconnect
semantics, bounded subscriber resources, and typed event payloads for query
invalidation, sync status, chore changes, and future celebration events.

Likely files: `src/server/events/`, SSE route, shared event types, tests.

## Acceptance

- Multiple clients receive relevant events.
- Dead clients are cleaned up and cannot leak listeners indefinitely.
- Events contain no credentials or private auth state.
- Client reconnect triggers safe cache revalidation even if events were missed.

Verify: multi-client stream and disconnect/reconnect tests.
