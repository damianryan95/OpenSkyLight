# K04 - Preserve UI parity and add centered scaling

Status: done  
Depends on: F02, K01

## Context

Read target architecture section 8/Shared visual system and Kiosk display.

## Deliverable

Introduce a centered maximum-width application shell for ultra-wide displays,
bounded responsive spacing/type, and full-viewport background. Tune at 2400x900
without stretching cards or enlarging controls excessively. Preserve 1280x800
behavior and the established visual system.

Likely files: global styles, shell/layout components, screenshot tests.

## Acceptance

- 2400x900 content is centered with intentional outer background.
- 1280x800 remains usable without horizontal clipping.
- 1920x1080 has no broken intermediate state.
- Minimum touch targets remain 48px and visual diffs are reviewed.

Verify: all three screenshot baselines plus keyboard-free manual navigation.
