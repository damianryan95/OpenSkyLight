# K05 - Add reconnect and stale-data states

Status: done  
Depends on: K01, G05, A05

## Context

Read target architecture sections 6 and 8/Kiosk display.

## Deliverable

Add subtle states for server reconnecting, Google never-synced/stale/failed, and
last successful sync. Continue rendering cached calendar data. Reconnect SSE and
revalidate queries automatically without blocking the full UI.

Likely files: browser API client, shell status components, query hooks, tests.

## Acceptance

- Google failure never replaces cached events with a blank error screen.
- Server loss is clearly distinct from Google staleness.
- Recovery happens without a manual reload.
- Status is noticeable but does not dominate the protected UI.

Verify: browser E2E with simulated disconnect/reconnect and stale responses.
