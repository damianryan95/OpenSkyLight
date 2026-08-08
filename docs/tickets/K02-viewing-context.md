# K02 - Add Family and personal viewing contexts

Status: done
Depends on: K01, G04

## Context

Read target architecture sections 2/Household and personal views and 8/Display
content behavior.

## Deliverable

Replace hidden-person filtering with explicit `family | person:<id>` viewing
context. Avatar taps select a person; add a clear Family control. Initialize to
Family on every app launch and never reset because of idle/screensaver state.
Apply context to all person-aware views and home tiles.

Likely files: UI store, header, calendar hooks, chores/rewards/home tiles, tests.

## Acceptance

- Family shows all events and all household chore/reward summaries.
- Person shows only derived events, their chores, balance, and rewards.
- Shared widgets remain unchanged.
- Reload/relaunch starts Family; inactivity does not switch context.

Verify: component/store tests and browser journeys for two people.
