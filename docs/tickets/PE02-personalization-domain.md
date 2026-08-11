# PE02 - Add person personalization contracts and persistence

Status: done
Depends on: PE01

## Context

Read personalization roadmap sections 1, 4, and 5. Read target architecture
sections 4, 5, 7, and 8.

## Deliverable

Add a forward-only migration and typed domain/API contracts for each person's
theme ID, celebration asset ID, enabled state, and bounded duration. Expose
parent mutations and display-safe reads. Keep theme manifests in a typed registry
contract; do not persist CSS class names, raw tokens, or filesystem paths on a
person record.

Existing households must migrate to the neutral OpenSkyLight theme and built-in
celebration fallback. Deleting a person or invalid reference must have defined,
safe behavior.

Likely files: `src/server/db/`, people domain/routes, shared API schemas/types,
domain/API tests.

## Acceptance

- Migration is forward-only, transactional, and covered from the current schema.
- Parent writes validate known theme IDs, asset references, enabled state, and a
  1500–5000 ms duration.
- Display reads expose only validated personalization needed for rendering.
- Family viewing context never receives a person's active theme assignment.
- Unknown/deleted theme or media references resolve to defaults rather than an
  error screen.
- Existing people and avatar/calendar behavior remain unchanged.

Verify: migration, domain, authorization, schema-validation, and typecheck tests.
