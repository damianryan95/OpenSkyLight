---
id: K21
title: Investigate portrait clipping in the Week view and Stars tile
status: planned
depends_on: []
related: [K04]
created_by: ai
created_at: 2026-09-26
created_in: ce823381-ce29-4548-9752-665a01c35498
why: "Seen in 800x1280 screenshots while verifying the collapsing header (23139a3): the Week view drops its seventh day column off the right edge, and the Home Stars tile clips its star counts. Not yet reproduced on the wall; recorded for later investigation, not fixed."
checked: [K03, K04, N20]
---

## Context

Seen in 800x1280 screenshots while verifying the collapsing header (23139a3): the Week view drops its seventh day column off the right edge, and the Home Stars tile clips its star counts. Not yet reproduced on the wall; recorded for later investigation, not fixed.

## Deliverable

An investigation first, then a fix only if the observations reproduce on a real
portrait panel. Two things were seen in headless Chromium at 800x1280 with a
household of three children and no calendars connected:

1. **Week view** shows Sunday to Friday and pushes Saturday off the right edge
   (the seventh day column is not on screen and the page does not scroll to it).
2. **Home, Stars tile** renders each child's avatar but clips the star count
   (`★ 0`) at the tile's right edge.

The user has not seen either on the wall, so the first job is to establish
whether these are real at a panel's true portrait resolution and pixel ratio, or
an artefact of the headless viewport used to verify the header.

## Likely files

- `src/renderer/src/features/calendar/WeekView.tsx` (or wherever the seven day
  columns are laid out)
- the Home tiles under `src/renderer/src/features/home/`, the Stars tile in
  particular
- the scratchpad script that produced the screenshots is not in the repo; the
  reproduction is: enrol a kiosk at 800x1280, three children, open Week and Home

## Acceptance

- Reproduced or ruled out on a real portrait display, with the resolution and
  device pixel ratio recorded here.
- If real: all seven day columns visible in Week at portrait, and the Stars tile
  shows every child's count in full, with no sideways scroll and landscape
  unchanged.
- If not real: the ticket closes with the reason the headless screenshots
  differed.

## Verify

- Drive the real server and kiosk bundle at the panel's resolution (Playwright,
  as `portrait-real.mjs` did for the header) and assert no header or tile
  control is off screen and `scrollWidth <= innerWidth` on Home and Week.
- Look at the screenshots, not only the assertions.
