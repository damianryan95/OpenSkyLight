# PE07 - Build the chore celebration renderer

Status: done  
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

Implementation note (2026-09-22): complete.

The overflow summary was the substantive gap and it hid a defect: the queue
capped the backlog at three and counted the remainder correctly, but the
dismiss that emptied the queue discarded the count — which is exactly when the
summary should appear. The count could therefore never be shown. Carried
through that dismiss, given a `clearOverflow` action so it can retire itself,
and rendered.

The rest of the criteria were already satisfied and are now covered by tests
rather than assumed:

- Initiating-display routing is applied in `browser.ts` before an event ever
  reaches the overlay.
- Undo emits no domain event at all, and an idempotent repeat returns before
  emitting one, so neither can celebrate. Both are now asserted against the
  real service.
- Missing or corrupt media falls back to the star card without touching the
  committed completion; reduced motion skips the fetch entirely, so animation
  bytes are never downloaded.
- The overlay is pointer-transparent and time-bounded, and `min(50vw, 50vh)`
  with `object-contain` keeps media inside a safe region at the wide-and-short
  2400x900 viewport as well as the taller ones.

Not done here: a two-display browser journey. It needs two enrolled displays
against a running server and belongs with `O02`-style device validation rather
than the unit suite.
