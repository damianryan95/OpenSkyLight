# PE10 - Harden and release personalization

Status: planned  
Depends on: PE04, PE06, PE07, PE08; PE09 only if included in the release

## Context

Read all of the personalization roadmap, target architecture sections 10–11,
and the current development handoff. Do not claim Raspberry Pi validation without
real-device evidence.

## Deliverable

Run the complete personalization matrix across multiple people/displays, color
modes, viewports, offline/reconnect states, reduced motion, and malformed/missing
assets. Extend backup/restore and operations documentation to cover managed
media and custom themes. Add observability for validation/fallback failures
without logging filenames, image bytes, credentials, or child-specific display
content.

Measure first theme application, context switching, animation decode/render,
memory cleanup, and rapid-completion behavior on the Raspberry Pi target. Tune
or block release against explicit budgets rather than desktop-only impressions.

Likely files: E2E/visual/accessibility tests, operations CLI/docs, Docker volume
docs, logging/metrics, release checklist and development handoff.

## Acceptance

- `npm run typecheck`, `npm test`, and `npm run build` pass on Node 22.13.1.
- Backup/restore round-trip preserves assignments, media bytes/hashes, and custom
  themes, and documents compatibility/rollback behavior.
- Two kiosks prove person themes stay consistent and celebrations target only
  the initiating display through disconnect/reconnect and server restart.
- Automated accessibility and reviewed visual matrices cover all bundled packs,
  supported viewports, light/dark, and reduced motion.
- Raspberry Pi evidence records no unbounded queue/memory growth and meets the
  roadmap performance target, or the ticket remains blocked with measurements.
- Security review covers image decoding, media authorization, cache headers,
  deletion, logs, and corrupted backup/media recovery.

Verify: core checks, personalization E2E/visual/a11y suites, backup/restore drill,
two-display test, and documented real-hardware run.
