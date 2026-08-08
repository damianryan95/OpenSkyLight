# G01 - Resolve the headless Google OAuth flow

Status: done  
Depends on: none

## Context

Read target architecture sections 6 and 7/Threat model.

## Deliverable

Research and prototype a Google-supported authorization flow that works for a
headless LAN server configured from a phone. Document client type, redirects,
setup steps, token refresh, cancellation/retry, and secure secret/token storage.
Use official Google documentation. This is a decision/spike, not production UI.

Likely files: an ADR under `docs/`, optional isolated proof-of-concept tests.

## Acceptance

- Flow is demonstrated or documented end-to-end on the LAN topology.
- It does not depend on Electron shell or a browser on the server host.
- Refresh tokens never silently fall back to plaintext.
- Any HTTPS/domain/operator prerequisites are explicit.

Verify: peer review the ADR and, if feasible, record a redacted successful spike.
