# N03 - Local network name for the server

Status: in progress
Depends on: S06, O03

## Context

Read `README.md` sections "How it fits together" and "Quick start with
Docker". Read [`docs/adr/0002-provider-agnostic-calendar-access.md`](../adr/0002-provider-agnostic-calendar-access.md):
because ADR 0002 removes the Google OAuth layer, the registered-hostname and
trusted-HTTPS prerequisite from the superseded ADR 0001 no longer applies, and
a local mDNS name is sufficient for the entire product.

## Deliverable

The server advertises a stable, memorable LAN name (for example via
mDNS/Avahi, `openskylight.local`) so a parent does not need to know or type a
raw LAN IP address for kiosk enrollment links or phone administration. The
numeric LAN address must keep working as a fallback.

Likely files: Dockerfile/compose (Avahi sidecar or host-networking note),
`README.md`, `docs/deployment/*`.

## Acceptance

- A phone on the same LAN reaches `http://openskylight.local:<port>/admin/`
  without being told the numeric IP.
- The numeric LAN address still works unchanged.
- The name also resolves for a phone connected over the `N07` tunnel, or the
  documentation states plainly that it does not and gives the working address.

Verify: manual resolution test from a phone and a laptop on the same LAN;
docs review.

Implementation note (2026-09-20): setup, verification steps and limitations are
in [`docs/deployment/local-network-name.md`](../deployment/local-network-name.md),
with an optional Avahi service record in `deployment/raspberry-pi/`.

The name is answered by the host's `avahi-daemon`, not by OpenSkyLight: a
bridge-networked container cannot answer LAN multicast, and does not need to —
the name resolves to the host and the published port forwards from there. So
this needs no application code and no mDNS dependency, only host configuration.
Enrollment links already derive from `window.location.origin`, so they inherit
the name as soon as a parent administers the board by it.

**Not yet verified.** The acceptance criteria need a phone resolving the name
against a real deployment; the remaining work is that test, not code.
