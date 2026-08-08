# F03 - Implement pure audience derivation

Status: done  
Depends on: none

## Context

Read target architecture sections 5/Calendar mappings and 5/Exact child-name
inference.

## Deliverable

Create an Electron-free pure module that derives effective person IDs from a
calendar mapping, event title/description, and household people. Include Unicode
normalization, case-insensitive whole-name matching, HTML description cleanup,
multi-word names, deduplication, and duplicate-name ambiguity handling.

Likely files: `src/shared/`, `tests/unit/`.

## Acceptance

- Mapped adults and children are included.
- Text inference adds children only.
- Adult text matches and substrings do not assign.
- Empty results mean Family-only; Family view semantics stay outside the matcher.
- Tests cover punctuation, markup, Unicode, multiple children, and duplicate names.

Verify: targeted unit test plus `npm run typecheck`.
