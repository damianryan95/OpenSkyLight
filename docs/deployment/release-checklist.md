# Release checklist

OpenSkyLight is a LAN/VPN-only household service. This checklist does not make
it suitable for public Internet exposure; use a VPN if remote access is needed.

## Supported compatibility

- Server image: Node.js 22.13.x, built from the matching immutable image tag.
- Browser kiosk: current stable Chromium on Raspberry Pi OS Desktop 64-bit
  (X11) for the Pi recipe; current stable Chromium or Chrome on Linux for
  desktop validation.
- Parent administration: the current stable Chromium, Chrome, Safari, or
  Firefox on a phone. JavaScript and cookies must be enabled.
- One server image version serves both kiosk and parent assets. Do not mix
  separately hosted client bundles with a different server version.

Before tagging, use Node 22.13.1 and run:

```fish
node --version
npm ci
npm run typecheck
npm test
npm run build
npm run test:kiosk-browser
npm run test:kiosk-connectivity
npm run test:multi-display
npm run test:operations
npm audit --omit=dev --audit-level=high
docker build --build-arg OSL_VERSION=0.8.0 --tag openskylight:0.8.0 .
```

The CI release workflow repeats the dependency audit, builds the immutable
container, and scans the resulting image. Review and remediate high/critical
findings before release; an accepted exception must identify the advisory,
affected image tag, expiry, and mitigation.

## Security review

- Verify PIN/session/display credential/Google token values are absent from
  `server.started`, failure, health, operation, and sync-status output.
- Confirm health endpoints disclose only liveness/readiness.
- Confirm a display can only read display data and complete/undo today's chore;
  parent mutations must reject a display credential.
- Confirm the image runs with one local Docker volume and no public port
  forwarding. SQLite WAL must not be stored on SMB or NFS.
- Configure Google OAuth through the authenticated parent portal; verify the
  entire application-data volume is persistent. The server creates its Google
  encryption key beside the database with owner-only permissions; do not copy
  it into image layers, Compose files, `.env`, browser storage, or logs.

## Upgrade and rollback

Use a maintenance window. Back up the current volume with the exact current
immutable image, then deploy the new immutable tag and wait for `/health/ready`.
Migrations run before readiness. If migration or readiness fails, do not retry
against the old volume: restore the pre-upgrade backup into a clean volume and
start the previous immutable image. Full Fish commands are in
[operations.md](operations.md).

## Required manual evidence

- Complete the [multi-display validation](../multi-display-validation.md) on
  the intended LAN.
- Complete the Raspberry Pi real-device checklist in
  [raspberry-pi-kiosk.md](raspberry-pi-kiosk.md), including touch, DPMS,
  reconnect, and boot without keyboard/mouse.

Record image tag, browser/OS versions, command results, exceptions, and the
backup path in the household runbook.
