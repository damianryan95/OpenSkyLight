# PE01 - Validate the personalization experience

Status: ready  
Depends on: none

## Context

Read personalization roadmap sections 1–3 and 8–9, plus target architecture
sections 8 and 9.

## Deliverable

Create deterministic, code-native prototypes for Family view, one personal
theme, theme switching, a standard celebration, and reduced-motion fallback.
Prototype the phone theme gallery and celebration upload/preview flow. Use
fixture data and lightweight local placeholder or household-supplied artwork;
do not add persistence or production routes.

Record the resulting interaction decisions and reviewed screenshots in docs.
Resolve safe-area, overlay duration, queue-summary, theme-transition, and loading
fallback behavior so later tickets do not invent incompatible behavior.

Likely files: isolated stories/test routes, screenshot tooling, `docs/screenshots/`,
personalization decision notes.

## Acceptance

- Family and personal contexts remain immediately distinguishable without
  moving controls or tiles.
- Prototypes cover 1280x800, 1920x1080, 2400x900, and a phone viewport.
- Contrast, 48 px targets, keyboard focus, and reduced motion are reviewed.
- Celebration never captures input or obscures the chore completion result for
  longer than its configured duration.
- Decisions needed by PE02, PE03, PE06, and PE07 are explicit and testable.
- Prototype media remains local, deterministic, and small enough for stable
  screenshot tests.

Verify: deterministic screenshot run plus documented keyboard/reduced-motion
review.
