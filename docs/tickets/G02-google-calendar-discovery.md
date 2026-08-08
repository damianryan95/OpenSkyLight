# G02 - Implement account and calendar discovery

Status: done  
Depends on: G01, S02, S03

## Context

Read target architecture sections 5/Calendar mappings and 6.

## Deliverable

Implement the selected OAuth flow, account connection state, remote calendar
discovery, selection, and mapping of each calendar to Family or one person.
Keep the service transport-neutral; parent HTTP routes come later.

Likely files: `src/server/sync/google/`, schema/DTO updates, tests.

## Acceptance

- Multiple calendars can be listed and selected.
- Each selected calendar maps to null/Family or exactly one person.
- Disconnect/reconnect and revoked credentials produce useful state.
- Tokens use the approved secure storage design.

Verify: mocked Google tests plus a documented manual integration check.

## Verification

- `npm run typecheck`
- `npm test -- --run tests/unit/googleDiscovery.test.ts tests/unit/serverDb.test.ts`
- `npm test`

### Manual integration check (operator-run)

With the G01 HTTPS hostname and exact callback URI, use the authenticated
parent portal to save the Web OAuth client ID/secret and a Google vault
passphrase. Start a parent connection, complete Google's phone-browser consent
screen, then list the account's calendars.
Select a Family calendar (null audience) and one calendar per household member;
restart the server and confirm the selections remain. Revoke access in the
Google account, refresh discovery, and confirm the account reports
reauthorization required. Finally disconnect and confirm the account and its
calendar mappings are removed; a revocation-network failure is reported while
the local encrypted token is still deleted.
