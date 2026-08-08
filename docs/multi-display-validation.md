# Multi-display validation

Run the automated three-client scenario from Fish after building dependencies:

```fish
set -lx OSL_CHROMIUM_PATH (command -v chromium)
npm run test:multi-display
```

It starts one temporary household server, registers Kitchen and Bedroom from a
parent session, and opens two isolated Chromium kiosk profiles. It verifies
cross-display state convergence, exactly-once chore awards, initiator-only
celebration delivery, stream interruption/reconnect, persisted server restart,
and parent revocation.

## Manual LAN run

1. Start the server and register two displays from the phone administration
   interface. Open each one with its own registration credential.
2. On Kitchen, complete a current-day chore. Confirm both displays and the
   phone show the completion and the star balance changes once. Confirm the
   celebration placeholder appears only on Kitchen.
3. Restart the server container. Both kiosks should retain their last rendered
   content while showing a reconnecting state, then return to normal without
   re-registration.
4. Temporarily disconnect one kiosk from Wi-Fi. Confirm its cached content
   remains visible with a reconnecting state; reconnect Wi-Fi and confirm it
   refreshes to the household state.
5. Revoke Bedroom from the phone. Reload Bedroom (or wait for its next
   reconnect) and confirm it cannot read household data. Confirm Kitchen stays
   connected and still operates normally.

Do this on the intended LAN before a release, including any real Pi kiosk.
