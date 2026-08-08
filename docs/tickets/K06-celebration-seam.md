# K06 - Add the celebration animation seam

Status: done  
Depends on: K01, A04, A05

## Context

Read target architecture section 9/Future full-screen animation.

## Deliverable

Add a dormant `CelebrationOverlay` host and typed handling for post-commit
`chore.completed` events targeted to the initiating display. Implement only a
test placeholder that proves lifecycle, queuing, dismissal, and failure
isolation; do not design final animation assets.

Likely files: kiosk shell/overlay, SSE event types/client, tests.

## Acceptance

- Only the initiating display reacts by default.
- Multiple rapid completions have deterministic queue behavior.
- Overlay failure cannot reverse or block chore completion.
- Placeholder is clearly isolated for later replacement.

Verify: component tests and two-display event routing test.
