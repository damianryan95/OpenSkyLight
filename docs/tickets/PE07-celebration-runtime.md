# PE07 - Build the chore celebration renderer

Status: planned  
Depends on: PE01, PE02, PE05

## Context

Read personalization roadmap sections 1–2, 4, and 8. Read target architecture
section 9 and inspect the completed K06 celebration seam.

## Deliverable

Replace the placeholder overlay with a production, person-aware celebration.
Resolve the event's person to validated display personalization, fetch assigned
media with the display credential, and render it with the child's name and
earned stars inside the tested safe region. Preserve post-commit failure
isolation and initiating-display routing.

Retain deterministic FIFO behavior, deduplicate completion IDs, cap the visible
backlog at three, and collapse overflow into the approved teamwork summary.
Reduced motion uses a static success presentation without decoding animated
media. Abort fetches and revoke object URLs on dismissal/unmount.

Likely files: celebration overlay/queue, display API hooks, shared event/types,
CSS, component/browser tests.

## Acceptance

- Newly completed chores show the correct person's assigned celebration only on
  the initiating display; undo and idempotent repeats never celebrate.
- Missing, slow, corrupt, or decoder-rejected media falls back immediately and
  cannot affect the committed completion or next queued event.
- Overlay is pointer-transparent, time-bounded, aspect-preserving, and correct at
  all supported kiosk viewports.
- Queue memory and visible playback time are bounded during rapid completions.
- Reduced-motion mode is static, accessible, and does not load animation bytes.
- Object URLs, timers, listeners, and fetches are cleaned up deterministically.

Verify: queue/component tests, two-display browser journey, offline/corrupt-media
journeys, reduced-motion test, and memory/resource cleanup assertions.
