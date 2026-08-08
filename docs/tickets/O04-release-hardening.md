# O04 - Perform final security and release hardening

Status: blocked  
Depends on: C04, O01, O02, O03

## Context

Read target architecture sections 7, 11, 13, and 14.

## Deliverable

Audit the final product against its LAN/VPN threat model, capability matrix,
secret handling, logging, HTTP limits, session behavior, dependency/image
scanning, browser compatibility, migrations, and documentation. This ticket
fixes release-blocking findings but does not expand to public-Internet support.

Likely files: cross-cutting tests/config/docs and focused fixes.

## Acceptance

- PINs, sessions, display credentials, and Google tokens are absent from logs.
- Display capability negative tests cover every mutation class.
- Supported browser/server compatibility and rollback policy are documented.
- Full test, visual, Docker, multi-display, and Pi checklists pass.

Verify: release checklist with commands, results, and accepted residual risks.

Implementation note (2026-08-04): release hardening is documented in
[`docs/deployment/release-checklist.md`](../deployment/release-checklist.md).
Node 22 verification, production dependency audit, browser kiosk checks,
multi-display checks, operations tests, and a version-labelled Docker image
have been run. This ticket remains blocked only pending the real Raspberry Pi
checklist required by O02.
