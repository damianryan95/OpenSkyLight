# S06 - Add Docker development packaging

Status: done  
Depends on: S01, S02, A01

## Context

Read target architecture sections 3, 11, and 12/Phase 1.

## Deliverable

Add a development/production multi-stage Dockerfile and sample Compose file with
a persistent `/data` volume, timezone/listen configuration, health checks, and
graceful shutdown. Do not publish an image or add production release automation.

Likely files: `Dockerfile`, `.dockerignore`, Compose example, server docs.

## Acceptance

- Container initializes an empty volume and survives restart with data intact.
- Health check distinguishes live from ready.
- Image contains no development credentials.
- LAN-only warning and local-volume requirement are documented.

Verify: build image, Compose up/health/restart smoke test.
