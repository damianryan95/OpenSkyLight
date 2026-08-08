# PE09 - Add the bounded custom theme composer

Status: planned  
Depends on: PE03, PE04, PE05, PE08

## Context

Read personalization roadmap sections 2–5 and 9. Review real usage feedback
from the curated theme release before starting this ticket.

## Deliverable

Add an optional phone-first composer that creates a custom pack from a bounded
set of semantic color roles, approved patterns/decorations, and optionally one
validated managed raster background. Persist versioned validated token JSON and
reuse the production preview/runtime.

Provide presets, reset/undo, automatic contrast feedback, safe image cropping,
and an explicit save step. Do not accept CSS, HTML, JavaScript, fonts, SVG,
archives, remote URLs, arbitrary token names, or arbitrary positioning/z-index.

Likely files: custom theme migration/domain/API, bounded token validator,
composer UI, shared preview, media references, tests.

## Acceptance

- Parents can create, preview, name, assign, edit, duplicate, and safely delete
  a custom theme from a phone.
- Server validation clamps/rejects every value outside the documented schema;
  clients cannot create CSS injection or remote fetches.
- The composer blocks unreadable text/focus combinations or repairs them with an
  explained accessible alternative.
- Deleting an assigned theme requires reassignment/fallback and never leaves a
  partially applied pack.
- Schema versions have a defined migration/fallback strategy.
- Custom background failure leaves the token-only theme fully usable.

Verify: property/fuzz tests for token validation, injection tests, phone E2E,
contrast tests, and kiosk visual regression.
