# P05 - Build display and diagnostics administration

Status: done  
Depends on: P01, A03, G05

## Context

Read target architecture sections 5/Device-specific data, 8/Parent phone
application, and 11.

## Deliverable

Add phone pages to approve/list/rename/revoke displays, edit device-specific
layout/theme/sleep settings supported by the browser product, and inspect server
and Google sync health. Never reveal device credentials or Google secrets.

Likely files: admin pages/hooks, device/status API routes, tests.

## Acceptance

- Two displays can be distinguished and managed independently.
- Revocation disconnects the targeted display.
- Diagnostics expose actionable status without secrets.
- Unsupported OS-level kiosk settings are clearly delegated to host setup.

Verify: two-device API/E2E tests and payload redaction assertions.
