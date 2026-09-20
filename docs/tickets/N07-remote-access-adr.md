# N07 - Self-hosted remote access via WireGuard

Status: planned
Depends on: N03, N04

## Context

Read [`docs/adr/0003-self-hosted-remote-access.md`](../adr/0003-self-hosted-remote-access.md)
in full, and `docs/tickets/A02-pin-sessions.md` for the trusted-network
assumptions this changes. This ticket was previously a blocked decision
spike; the mechanism is decided and it is now an implementation ticket.

Cloudflare Tunnel and Tailscale's hosted coordination service are rejected by
ADR 0003 and must not be reintroduced.

## Deliverable

Let a parent reach parent administration from anywhere, by extending the
trusted network to their phone rather than publishing the web surface.

- Run WireGuard on the Pi. Generate per-peer configurations and render each as
  a QR code the parent scans with the official WireGuard app — this is the
  whole setup, and it belongs in the `N04` wizard as an optional step.
- List, name, and individually revoke peers from parent administration,
  mirroring the existing display registration and revocation model.
- Bind the HTTP surface to the LAN and tunnel interfaces only. It must not be
  reachable on a public interface under any configuration.
- Add rate limiting and lockout to the PIN endpoint, because the wizard
  encourages short PINs and the tunnel makes the endpoint reachable from
  outside the house.
- Keep display enrolment (`A03`) LAN-scoped: a kiosk is never enrolled over
  the tunnel.
- Document the one deployment prerequisite honestly — a single inbound UDP
  port forward plus a stable address or dynamic DNS — and document the CGNAT
  fallback (self-hosted Headscale or NetBird) that ADR 0003 accepts.

Remote access is opt-in. A household that never enrols a peer must run
exactly as it does today, with no new exposure.

Likely files: deployment configuration, a WireGuard peer-management service in
`src/server/`, `src/server/api/router.ts` (rate limiting, peer routes),
companion administration UI, deployment docs.

## Acceptance

- A parent scans a QR code once and can reach `/admin/` from a mobile network
  with no third-party service involved.
- Revoking a peer immediately ends its access.
- A port scan from outside the household finds no HTTP surface — only the
  WireGuard UDP endpoint.
- Repeated wrong PIN attempts are rate limited and locked out, with the
  lockout observable in diagnostics.
- With no peer enrolled, the deployment's exposed surface is unchanged from
  today.

Verify: external port scan, peer revocation test, PIN brute-force/lockout
test, and a documented real-network check from a mobile connection.

Security review required before merge, per the consequences listed in
ADR 0003.
