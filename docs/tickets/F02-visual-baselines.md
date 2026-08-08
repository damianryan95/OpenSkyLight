# F02 - Capture visual baselines

Status: done
Depends on: none

## Context

Read target architecture sections 8/Shared visual system, 8/Kiosk display, and
12/Phase 0.

## Deliverable

Extend the existing screenshot tooling to capture deterministic reference images
at 1280x800, 1920x1080, and 2400x900. Record the fonts, CSS tokens, seeded data,
and routes used for visual parity.

Likely files: `scripts/shot-*.mjs`, `docs/screenshots/`, test configuration.

## Acceptance

- One documented command regenerates all baseline sizes.
- Captures use deterministic data and wait for fonts/rendering.
- Existing screenshots are not silently replaced without review.
- The ticket does not redesign or rescale the UI.

Verify: run the screenshot command twice and confirm stable output dimensions.
