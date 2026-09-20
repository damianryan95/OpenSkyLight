# N11 - Device access hardening (deferred)

Status: planned
Depends on: N07

## Context

Re-review `docs/tickets/A02-pin-sessions.md` and `A03-display-auth.md` once
`N07`'s ADR exists and its remote-access decision is known. Per the source
notes, this belongs to the later "project considered sellable" phase.

## Deliverable

Restrict all access to the Pi — SSH, any administrative surface, and any
remote-access channel accepted under `N07` — to the developer/owner only, per
the source note: "nobody should be able to access this thing unless they are
the developer, me." Full scoping depends on what `N07` actually accepts.

Likely files: to be determined at scoping time; likely touches deployment
docs, SSH/firewall configuration, and whatever remote-access mechanism `N07`
introduces.

## Acceptance

- No access path exists to the device beyond the household PIN session and an
  explicitly owner-controlled remote-access credential (if `N07` accepted
  one).
- SSH, if enabled at all, is key-only and not reachable from `N07`'s
  remote-access channel by default.

Verify: to be determined at scoping time; must include a port/surface
enumeration from outside the LAN.
