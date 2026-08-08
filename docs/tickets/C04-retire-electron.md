# C04 - Retire Electron and update project documentation

Status: done
Depends on: C01, C02, C03, K02, K03, K04, K05, K06, P02, P03, P04, P05, O01

## Context

Read target architecture sections 10, 11, and 12/Phase 6.

## Deliverable

After browser and phone parity is accepted, remove Electron main/window/preload,
IPC-only code, updater/installer configuration, Electron build dependencies, and
obsolete scripts. Make server plus web clients the default development/build
path and rewrite README architecture/setup instructions.

Likely files: `src/main/`, `src/preload/`, build configs, package files, scripts,
README and screenshots tooling.

## Acceptance

- Production/runtime dependency tree contains no Electron.
- Standard dev command runs server and web clients.
- Docker/browser documentation is accurate and Windows-only guidance is gone.
- Protected UI screenshots and full test suite pass.

Verify: clean install/build/test, dependency audit, Docker and browser smoke tests.
