# PE06 - Add parent celebration setup and preview

Status: planned  
Depends on: PE02, PE05

## Context

Read personalization roadmap sections 2–4. Read target architecture section
8/Parent phone application.

## Deliverable

Extend the per-person **Personalize** flow with celebration upload, library
selection, enable/disable, bounded duration, replacement, deletion, and preview.
Reuse the production media presentation component for preview so sizing and
fallback behavior match the kiosk.

Explain accepted formats and limits before upload, recommend WebP where
transparency/file size matters, and show server validation errors next to the
picker. Do not add sound, video, SVG, remote URLs, or unconstrained positioning.

Likely files: people personalization UI, upload/API hooks, shared celebration
preview, phone E2E tests.

## Acceptance

- A parent can upload, preview, assign, replace, disable, and remove a person's
  celebration from a phone.
- Built-in fallback remains selectable and previewable without an upload.
- Preview includes the child's name, stars, safe region, duration, and a
  reduced-motion mode.
- Upload progress/busy state prevents duplicate submissions; errors do not erase
  the previous valid assignment.
- Deletion explains and prevents removal while another person references the
  asset.
- Object URLs and in-flight requests are cleaned up on replacement/unmount.

Verify: phone viewport E2E, upload error journeys, API tests, and object-URL
lifecycle component tests.
