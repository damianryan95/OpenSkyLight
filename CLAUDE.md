# OpenSkyLight

Self-hosted household dashboard for a wall display: calendar, chores, star
rewards, lists, meals, weather, per-person views. One Docker server on the home
LAN. Any browser can be a kiosk; parents administer from a phone at `/admin/`.

## Commands

```fish
npm ci                 # Node 22.13.x — see .nvmrc; CI runs 22.13.1
npm run dev            # server plus both Vite clients
npm run typecheck      # tsc over server and web projects
npm test               # vitest
npm run build          # server + kiosk + companion bundles
```

CI (`.github/workflows/linux-ci.yml`) additionally runs
`npm audit --omit=dev --audit-level=high`, a Docker build, and a Trivy scan that
**fails on fixable HIGH/CRITICAL**. Run it on demand with `workflow_dispatch`.

## Architecture in one pass

- `src/server/` — the only process that owns SQLite. Domain services in
  `domain/`, calendar sync in `sync/`, one HTTP router in `api/router.ts`.
- `src/renderer/` — the kiosk at `/`. Read-only by design (see `K03`).
- `src/companion/` — parent administration at `/admin/`. Vite base **must**
  stay `/admin/` or its assets collide with the kiosk's at `/assets/`.
- `src/shared/` — DTOs, contracts, recurrence expansion, pure helpers.
- Migrations are an ordered, append-only array in `src/server/db/migrations.ts`.

## Documentation is authoritative — read it before proposing

This repo is documentation-driven. When code and docs disagree, that is a bug to
fix, not a thing to work around.

| For | Read |
| --- | --- |
| Where the work is going | `docs/phone-first-roadmap.md` |
| What to build next, and its gates | `docs/delivery-plan.md` |
| A specific scoped task | `docs/tickets/` and its `README.md` |
| Why calendars work as they do | `docs/adr/0002-provider-agnostic-calendar-access.md` |
| Where an authored event goes, and who wins a conflict | `docs/adr/0007-calendar-write-back.md` |
| Why remote access works as it does | `docs/adr/0003-self-hosted-remote-access.md` |
| What upstream had that this lacks | `docs/removed-functionality-audit.md` |

`docs/adr/0001-*` is **superseded**; it is kept for history only.

## Product principles

These settle most design arguments. Check them before proposing anything.

1. **The non-technical household user is the target operator.** A step that
   needs a cloud console, a verified domain, a client secret, or a terminal is a
   defect, not a prerequisite.
2. **The household owns its data and infrastructure.** No third-party-operated
   cloud service — only things installable locally and free of licence fees.
   Cloudflare Tunnel and Tailscale's hosted plane were rejected on this basis.
3. **Vendor-agnostic.** Sync whatever calendar the user already has, via open
   standards. No single vendor may become the only path.
4. **Phone-first, anywhere** — without giving up the LAN-only security posture.

## Invariants — do not break these casually

- **The kiosk is read-only, with two carve-outs and no more.** It may tick
  today's chores (`A04`), and — since `N15` — create, edit and delete calendar
  events while the household PIN unlock is live. Everything else stays refused
  by the `default` arm of the display RPC whitelist. If you find an unhandled
  write channel for a display, that is usually correct.
- **OpenSkyLight is itself a calendar.** An event authored on the board lives
  there and syncs outward *only* when a person is tagged and that person has a
  linked writable calendar. Staying local is the normal outcome, never an error.
- **Electron is gone.** Do not restore main/preload code or Electron tooling.
- **Display credentials** are fragment-based and single-use. Never put one in a
  query string, a log, or server-rendered history.
- **One server owns the SQLite volume.** Local disk only, never SMB/NFS.
- **Remote error bodies never reach logs, messages, or the UI** — they can echo
  credentials. Errors surfaced to a parent are written deliberately.

## Gotchas that will otherwise cost you time

- **On Windows, 4 tests in `tests/unit/eventFeeds.test.ts` always fail** with
  `EPERM` in the `afterEach` cleanup — SQLite still holds the temp file. The
  assertions pass; Linux CI is green. Do not debug them, and do not report a
  change as having broken them.
- **Startup errors are deliberately redacted** (`src/server/logging.ts`), so
  `docker logs` will never say why `main()` failed. Reproduce the startup steps
  manually in a throwaway container to see the real error.
- **`OSL_SERVER_HOST` and `OSL_SERVER_PORT` are the container's *internal*
  bind** and must stay `0.0.0.0` and `3000`. The LAN-facing address and port
  belong only in the compose `ports:` mapping. Overriding them produces a
  silent crash loop or an unreachable container.
- **SQL strings are not typechecked.** A column rename compiles clean and fails
  at runtime — exercise the query.
- Git Bash mangles container paths; use `MSYS_NO_PATHCONV=1` and `//var/run/...`.

## Conventions

- Prefer editing existing files. No new docs unless asked.
- Comments explain *why*, not *what*, and only when the why is non-obvious.
- British English in prose.
- Verify by running the real thing, not only by passing tests. Say plainly what
  remains unverified rather than rounding "implemented" up to "working".

Ticket workflow and the agent handoff contract are in `AGENTS.md`.
