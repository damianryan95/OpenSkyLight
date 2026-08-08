# G04 - Integrate effective event audiences

Status: done  
Depends on: F03, G03

## Context

Read target architecture sections 2/Household and personal views and 5.

## Deliverable

Combine cached occurrences, calendar mappings, current people, and the pure
matcher into Family and personal event-feed queries. Keep derivation dynamic so
renaming a child changes inference without rewriting cached Google events.

Likely files: server event query service, shared occurrence DTOs, tests.

## Acceptance

- Family feed contains every active occurrence.
- Personal feed contains only occurrences whose derived IDs include that person.
- Empty audiences are Family-only.
- Calendar mapping plus child-name matches are additive and deduplicated.

Verify: query integration tests across recurring and ordinary events.
