# PE05 - Add managed celebration media

Status: planned  
Depends on: PE01, PE02

## Context

Read personalization roadmap sections 2 and 4. Read target architecture sections
4/SQLite operation, 5/Data ownership, 7, and 11.

## Deliverable

Add parent-authenticated upload/list/delete endpoints and display-authenticated
fetching for celebration PNG, GIF, and WebP assets. Store bytes under a managed
media directory in the persistent data volume and metadata in SQLite. Inspect
magic bytes and decoded metadata server-side; reject SVG, malformed media,
files over 10 MB, dimensions over 2048 x 2048, or more than 300 frames.

Use opaque storage keys, atomic writes, SHA-256 deduplication where safe, and
compensating cleanup across database/file failures. Never return absolute paths
or accept client-selected destination paths.

Likely files: media migration/domain, API routes/contracts, filesystem adapter,
Docker/deployment configuration, tests.

## Acceptance

- Extension/MIME spoofing, path traversal, SVG, oversized dimensions/bytes/frame
  count, and corrupt files are rejected with safe messages.
- A registered display can fetch assigned media but cannot upload, enumerate, or
  delete parent assets.
- Responses set correct content type, nosniff, private caching, and bounded
  content length; secrets and filesystem paths do not appear in logs.
- Referenced assets cannot be physically deleted; unreferenced deletion removes
  both metadata and bytes without orphaning on expected failures.
- Empty/missing media directories initialize safely on a fresh container.
- Image-decoder dependencies and malformed-image fixtures receive a security
  review before merge.

Verify: API authorization tests, adversarial upload fixtures, filesystem failure
tests, fresh-container test, typecheck, and build.
