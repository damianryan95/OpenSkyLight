# Delivery plan

Status: active
Last updated: 2026-09-20
Strategy: [`phone-first-roadmap.md`](phone-first-roadmap.md)
Tickets: [`tickets/README.md`](tickets/README.md)

This is the execution plan: what gets built, in what order, with what gates.
The roadmap says *why* and *what*; this says *when* and *how we know it
worked*.

## Current deployment status

The Portainer stack on `home-server` is a **basic deployment smoke test only**.
Nothing is connected to it, it holds no real household data, and no calendar
source is configured. It is not a production instance and nothing in this plan
needs to protect it.

Consequences, which this plan assumes throughout:

- **There is no data to migrate or preserve.** Schema changes amend the
  existing migrations in place; existing volumes are discarded and rebuilt.
- **No backups are required before schema work.**
- **Greenfield posture.** Removing a capability before its replacement lands
  carries no user impact — sequencing is driven by keeping each phase coherent,
  not by protecting live state.

## Ground rules

- **One ticket per branch**, named `ticket/<id>-<slug>`. The agent handoff
  contract in `tickets/README.md` applies unchanged.
- **CI is the gate.** Every branch must pass the existing Linux CI job:
  `npm ci`, `npm run typecheck`, `npm test`, `npm audit --omit=dev
  --audit-level=high`, a Docker build, and the Trivy scan. Nothing merges red.
- **Push per completed phase, not per ticket.** Work accumulates locally and on
  branches; a phase is the unit of delivery to `origin`. Tickets within a phase
  merge locally and go up together when the milestone's exit criteria are met.
- **Preserve unrelated worktree changes.** This repo carries broad in-progress
  work; do not reset or discard outside the ticket at hand.

## Milestone 1 — Calendar independence

**Tickets:** `N13` + `N14` (shipped together), then `N17`, then `N05`
**Blocked by:** nothing — deliberately has no hardware dependency
**Goal:** the product syncs any calendar, with no Google Cloud project, client
secret, domain, or HTTPS prerequisite.

`N13` removes the only calendar source the product currently has, so the phase
is only coherent once `N14` lands beside it. Both are built before this
milestone is pushed.

`N17` sits here because `N05` cannot authenticate without it: the parent auth
model was same-origin by construction and a phone app is not same-origin. It
has no hardware dependency either, and it also gates `N18` in Milestone 2.

**`N05` is Android-only** (owner's direction, 2026-09-23). iOS needs Xcode and
therefore a Mac, so holding `N05` open for it would block the milestone on
hardware nobody has. Everything iOS-specific is `N19`, which is `blocked` and
says so plainly. `N19` is not scheduled into a milestone: it is the same shape
of dependency as `O02`, and acquiring the hardware is the gating action rather
than writing code.

Sequence:

1. **`N13` — retire the Google layer.**
   1. Amend the existing migrations in place so the Google tables were never
      created; `events.google_event_id` becomes `source_event_id` with a
      `source` discriminator, and the calendar table becomes source-neutral.
   2. Delete `src/server/sync/google/`, its routes in `api/router.ts`, and its
      wiring in `server.ts`.
   3. De-Google `src/shared/eventFeeds.ts` and `src/shared/api/contract.ts`.
   4. Rework sync health around per-source liveness; add the "no calendar
      connected" state.
   5. Strip the Google connect/vault UI from the companion and kiosk settings.
   6. Drop `@googleapis/calendar` and `google-auth-library` from
      `package.json`.
2. **`N14` — CalDAV and ICS source**, built on the seam from step 1.
3. **Push the milestone** once both are merged locally and CI is green.
4. **`N05` — phone-native connector** follows as its own piece of work. The
   delivery vehicle it lacked is settled (ADR 0005, Capacitor) and phase 1 has
   landed: the companion now builds and runs as an installed Android app that
   pairs with a household over the `N17` bearer path. What remains is the
   connector itself — the push contract, then the native calendar read on a
   real Android device, then the CI build. Android only; iOS is `N19`. Phase 2
   (the push contract, with its ordering guard and CalDAV deduplication) is
   built and server-verified; phase 3 is the first part that needs hardware.

**Exit criteria:** a parent connects a calendar from a phone using only a URL
and an app password, events appear correctly on the kiosk including recurrence
and all-day handling, no Google-specific code or schema remains anywhere in the
migration sequence, and a fresh volume builds cleanly.

## Milestone 2 — Phone-first onboarding

**Tickets:** `N02`, `N03`, `N18`, `N04`, and the already-open `O02` / `O04`
**Blocked by:** `O02` needs real Raspberry Pi 5 hardware
**Goal:** a parent with a factory Pi and a phone reaches a working kiosk with
no keyboard, monitor, or documentation.

`N03` (mDNS name) has no hardware dependency and can be pulled forward into
Milestone 1's slack time. `N02` and `N04` cannot start until `O02` produces
real-hardware evidence, so **acquiring the Pi is the scheduling priority here**,
not writing code.

`N18` is the ceremony ADR 0006 settled — the screen displays a QR, the phone
scans it — and it is what `N04`'s wizard is entered through. It depends on
`N17` rather than on hardware, so like `N03` it can be pulled forward while the
Pi is unavailable. It also removes most of `N03`'s job for app clients, since
the QR carries the server address; `N03` still matters for the browser.

Sequence: `N03` → `N18` → (`O02` evidence) → `N02` → `N04` → `O04` closes out.

**Exit criteria:** `O02` and `O04` both move off blocked with recorded hardware
results, and the wizard path is proven end-to-end on a factory image.

## Milestone 3 — Anywhere access and two-way sync

**Tickets:** `N06`, then `N15`, then `N07`
**Blocked by:** `N03`, `N04` (N07); `N05`, `N14` (N06); `N06` (N15)
**Goal:** manage the board from anywhere over a self-hosted tunnel, and write
events back to the underlying calendar.

**Order corrected, 2026-09-25.** `N07` was written first here, but it is gated
on `N03`/`N04` and therefore on Pi hardware, while `N06` and `N15` are gated on
nothing. Both were taken first for the same reason `N03` and `N18` were pulled
into Milestone 2: waiting on hardware is not a plan.

`N07` requires a security review before merge per ADR 0003 — budget for it
rather than treating it as a formality. The design note `N06` was to produce
before implementation is [ADR 0007](adr/0007-calendar-write-back.md), which also
settles `N15`'s routing and re-tag rules.

`N15` restores on-screen event editing, which upstream had and the headless
re-platforming removed. It is last in this milestone because it needs `N06`'s
write path, and because it is the second ticket to narrow `K03` — the
read-only display guarantee — so it should land while that decision is fresh
rather than months later.

**Exit criteria:** an external port scan finds no HTTP surface, PIN lockout is
demonstrable, and a round-trip event edit reaches the parent's own calendar app.

`N06` and `N15` are both built and both sit at `in progress`, because that last
exit criterion is exactly what neither has been able to demonstrate: no real
CalDAV account has been written to, and the Android write path has not run on a
device. Everything that does not need a connected calendar — the board's own
calendar, on-screen create/edit/delete, the PIN gate, recurrence, persistence
across a restart — is driven and passing.

## Milestone 4 — Backup and resilience

**Tickets:** `N08`, then `N09`
**Blocked by:** nothing (`O03` is done)

Can run in parallel with Milestone 2 or 3 — it touches the operations layer
rather than the calendar or network layers, so file conflicts are unlikely.

**Exit criteria:** a scheduled backup lands on USB and restores cleanly into an
empty volume; the user's own cloud target works without any intermediary.

## Milestone 5 — Deferred "sellable product" phase

**Tickets:** `N10`, `N11`, `N12`
Explicitly deferred per the source notes. Do not schedule until Milestones 1–3
are stable.

## Parallel track — personalization

`PE05`, `PE06`, `PE07` are in progress; `PE08`–`PE10` planned. They are
independent of everything above and continue on their own cadence. `N13` must
not disturb the celebration or display-auth paths — that is an explicit
acceptance criterion.

## Risk register

Data loss, migration failure, and existing-install compatibility are **not**
risks on this project — see "Current deployment status". They are deliberately
excluded from this register rather than mitigated.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Mobile background limits make `N05` stale | Board silently wrong in the morning | `N14` CalDAV path is the freshness guarantee; staleness is surfaced in the UI |
| `N05` needs a mobile app capability the repo lacks | Hidden scope explosion | Scope the delivery vehicle and report before building; split the ticket |
| `O02` Pi hardware unavailable | Milestone 2 stalls indefinitely | Milestones 1 and 4 are hardware-independent; sequence them first |
| Remote access widens attack surface | Household exposure | Tunnel-only, no public HTTP, PIN lockout, security review gate in `N07` |
| CalDAV behaves inconsistently across providers | `N14` passes against one provider, fails against another | Fixture-based tests covering at least iCloud- and Nextcloud-shaped responses |
| De-Googling touches 20+ files outside `sync/google` | Breakage in unrelated paths | Explicit acceptance criterion that kiosk, display auth, and celebration paths are untouched; CI gate |

## Immediate next actions

1. Start `N13` on `ticket/N13-retire-google-oauth`, amending migration 001
   first so the rest of the removal has a clean schema to build against.
2. Follow with `N14` on the same milestone.
3. Push once Milestone 1's exit criteria are met.
