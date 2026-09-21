# OpenSkyLight contributor notes

Project orientation, architecture, product principles, invariants and known
gotchas are in [`CLAUDE.md`](CLAUDE.md). Read that first. This file covers how
work is organised and handed over.

## The ticket workflow

Work is decomposed into bounded tickets in `docs/tickets/`, each sized for an
agent with limited context. `docs/tickets/README.md` holds the full handoff
contract; the essentials:

- Give an agent **one ticket ID**. It reads that ticket, the tickets README,
  the architecture sections the ticket names, and only the files it must touch.
- Every delivery includes the implementation and its tests, verification
  results, a changed-file summary, and any newly discovered risk.
- **No unrelated cleanup or redesign.** If an acceptance criterion needs an
  unresolved product decision, stop and report it rather than deciding alone.
- Do not start dependent or follow-up tickets.

### Ticket status is a promise

`planned` → `ready` → `in progress` → `done`, or `blocked`.

**A ticket is not `done` until its verification and acceptance criteria pass**,
not when the code compiles. `N03` is currently `in progress` precisely because
its criterion needs a phone on a real LAN. Mark honestly; an optimistic `done`
is worse than an open ticket.

### Series in play

`F`/`S`/`A`/`G`/`K`/`P`/`C`/`O` are the original headless refactor — mostly
`done`. Treat `G01`–`G05` (Google) as historical: ADR 0002 superseded them and
`N13` deleted the code.

`PE` is person themes and chore celebrations; `docs/personalization-roadmap.md`
is authoritative for its product decisions.

`N` is the current phone-first platform work; `docs/phone-first-roadmap.md` and
`docs/delivery-plan.md` are authoritative for sequencing.

## Working agreements

- **Push per completed phase, not per ticket.** Work accumulates locally and on
  branches; a milestone is the unit of delivery to `origin`.
- **Preserve unrelated worktree changes.** This repo carries broad in-progress
  work. Never use reset or checkout to discard anything outside your task.
- **Correct documentation in the same change that invalidates it.** A stale doc
  is a defect here, because the docs are how work is coordinated.
- Branch naming: `ticket/<id>-<slug>`.

## Environment

- Node `22.13.x` (`.nvmrc`); CI runs 22.13.1. Core checks are
  `npm run typecheck`, `npm test`, `npm run build`.
- Browser checks need a Chrome path in `OSL_CHROMIUM_PATH`.
- Deployment docs use Fish examples for consistency with the existing guides.

`docs/development-handoff.md` predates the `N` series and understates what is
complete. Trust ticket statuses and `docs/delivery-plan.md` over it.
