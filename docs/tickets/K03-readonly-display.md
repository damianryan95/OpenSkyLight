# K03 - Enforce the read-only display experience

Status: done, narrowed twice  
Depends on: K01, A03, A04

## Narrowed by N06, N15 and N20 — what still holds

This ticket is **not** superseded, but it has been narrowed three times, each
by an explicit product decision:

- `N15` — calendar events are writable from a display, inside the PIN-bounded
  unlock window that already gated display layout editing.
- `N20` — **chores and rewards administration** (create, edit, archive; grant a
  reward request) is writable inside that same window. **Lists are open to
  anyone at the wall, structure included, with no PIN** (owner's direction,
  2026-09-26: a shopping list nobody standing at it can add to is not a
  shopping list; the cost that a child can delete one was accepted).

Everything else K03 covers — chores beyond today, redeeming a reward, meals,
people, calendars, household settings, companion pairing — is still refused,
whether or not the window is open, by the `default` arm of the display RPC
whitelist in `src/server/api/router.ts`.

`tests/unit/displayAuth.test.ts` asserts the boundary in both directions: each
carve-out is accepted under its own rule, the window expires without leaving a
writable surface behind, and every other mutation still answers 403.

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
