# K03 - Enforce the read-only display experience

Status: done, narrowed twice  
Depends on: K01, A03, A04

## Narrowed by N06 and N15 — what still holds

This ticket is **not** superseded. Calendar events became writable from a
display in `N15`, and only inside the PIN-bounded unlock window that already
gated display layout editing. Everything else K03 covers — chores beyond
today, lists, meals, rewards, household settings — is still refused, whether
or not that window is open, by the `default` arm of the display RPC whitelist
in `src/server/api/router.ts`.

`tests/unit/displayAuth.test.ts` asserts the narrower boundary in both
directions: the three event channels are refused while locked and accepted
while unlocked, the window expires without leaving a writable surface behind,
and every other mutation still answers 403.

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
