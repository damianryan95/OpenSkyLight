# K03 - Enforce the read-only display experience

Status: done  
Depends on: K01, A03, A04

## Context

Read target architecture sections 2/Display permissions and 8.

## Deliverable

Remove/hide display controls for event editing, settings mutations, reward
redemption, lists, meals, layouts, and other writes. Preserve calendar view
navigation, event detail viewing, weather drill-in, shared widget navigation,
and today's chore complete/undo. Treat the API as the real security boundary.

Likely files: App/header/editor, feature components, route/API usage, E2E tests.

## Acceptance

- No add/edit/delete event affordance remains on the kiosk.
- Rewards are visible but cannot be redeemed.
- Lists/meals/widgets are read-only.
- Today's chore toggle remains touch-friendly and server-authorized.

Verify: capability-focused Playwright journey and API negative tests.
