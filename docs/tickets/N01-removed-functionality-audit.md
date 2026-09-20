# N01 - Audit functionality removed from the upstream project

Status: done
Depends on: (none)

## Context

Read `README.md` and `docs/tickets/C01-remove-camera.md`,
`C02-remove-birdnet.md`, and `C03-remove-event-writes.md`. Read
`docs/phone-first-roadmap.md` section 1 for why this exists.

## Deliverable

Produce a bullet-list document enumerating every user-facing feature present
in upstream `lowerygt/OpenSkyLight` (as of its `v0.8.0` tag, the fork point)
that is absent from this fork today. For each item, note whether it was
deliberately removed (cite the ticket, e.g. `C01`) or simply never carried
forward, and note any replacement this fork already offers. This is a
decision aid for the household developer to select what should return — it
must not itself restore any feature or write application code.

Likely files: new `docs/removed-functionality-audit.md`.

## Acceptance

- Every `C0x`-removed feature (camera, BirdNET, two-way calendar editing) is
  listed with its removal ticket.
- Every upstream top-level home-tile/feature is checked against the fork's
  current `src/renderer/src/features` and `src/renderer/src/features/home`
  tile registry and flagged present or absent.
- No code changes accompany this ticket.

Verify: manual cross-check against the ticket files above and the upstream
repository at tag `v0.8.0`.

Result (2026-09-20): [`docs/removed-functionality-audit.md`](../removed-functionality-audit.md).
Beyond the expected `C01`–`C03` removals, the audit found five features whose
UI is still reachable but whose server handlers do not exist — most visibly the
News tile, which a parent can still add and which can never load. Those are
loose ends from the headless re-platforming rather than decisions, and are
listed separately in section 3 for a restore-or-remove call.
