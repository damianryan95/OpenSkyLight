# ADR 0003: Self-hosted remote access, no third-party cloud

**Status:** Accepted (direction set by the project owner, 2026-09-20)
**Date:** 2026-09-20
**Decision owner:** project owner

## Context

The README inherited from the previous fork states the service is for "one
trusted household LAN or VPN" and must never be exposed to the public
Internet. That stance protects a PIN-session model (`A02`) that was designed
against a trusted network, but it also means a parent cannot manage the family
board while away from home — which conflicts with the phone-first direction in
`docs/phone-first-roadmap.md`.

The owner's constraint on solving it:

> All cloud services must be owned by the solution, not a 3rd party provider,
> unless it is installable locally and does not require licence fees.

## Decision

Provide remote access by **extending the trusted network to the parent's
phone**, not by publishing the web surface to the Internet.

The web application is never exposed publicly. The only inbound service is an
encrypted tunnel; the kiosk and administration surfaces remain reachable only
from inside it. This preserves the substance of the inherited LAN-only stance
while delivering anywhere access.

### Accepted mechanism

**WireGuard, self-hosted on the Pi, with QR-code peer enrolment.**

- WireGuard is in the Linux kernel, has first-party iOS and Android apps, is
  free, and involves no third-party service whatsoever.
- The setup wizard (`N04`) generates a peer configuration and renders it as a
  QR code. The parent scans it with the WireGuard app. That is the entire
  remote-access setup, which suits the non-technical user this product serves.
- Peers are individually revocable from parent administration.

### Rejected

- **Cloudflare Tunnel** — operated by a third party and not installable
  locally. Fails the owner's constraint outright, regardless of price.
- **Tailscale's hosted coordination service** — same reason. Tailscale's
  *clients* are acceptable only when pointed at a self-hosted control plane.

### Accepted fallback for carrier-grade NAT

Direct WireGuard needs one inbound UDP port and a stable address (port
forward plus dynamic DNS). Households behind CGNAT cannot provide that. For
those, a self-hosted coordination/relay plane the household itself owns is
acceptable — **Headscale** or **NetBird**, both BSD-3 licensed, self-hostable,
and free of licence fees. Running one on a VPS the household rents satisfies
"owned by the solution", because no third party operates the service or holds
the keys.

## Security consequences

Remote reachability invalidates assumptions `A02` was built under. Before
remote access is enabled:

- the HTTP surface must be bound so that it is reachable on the LAN and the
  tunnel interface only, never on a public interface;
- the PIN endpoint requires rate limiting and lockout, because the phone-first
  wizard makes a short PIN likely and the tunnel makes the endpoint reachable
  from outside the house;
- display credentials (`A03`) remain LAN-scoped; a kiosk is never enrolled
  over the tunnel;
- tunnel peer enrolment is a parent-authenticated action, and each peer is
  independently revocable, matching the existing display-revocation model.

## Consequences

- The README's "do not expose to the public Internet" guidance stays, and is
  clarified: no *web* surface is published; a WireGuard UDP endpoint is.
- One inbound UDP port forward becomes a documented, optional deployment
  prerequisite for remote access. Purely local households skip it entirely
  and lose nothing.
- Remote access is opt-in. A household that never enrols a tunnel peer runs
  exactly as it does today.

## Follow-up

`N07` implements WireGuard peer enrolment and the binding/rate-limit changes
above. `N11` revisits overall device access hardening once this lands.
