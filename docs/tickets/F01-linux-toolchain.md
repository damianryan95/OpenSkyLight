# F01 - Pin the Linux toolchain

Status: done
Depends on: none

## Context

Read target architecture sections 12/Phase 0 and 13.

## Deliverable

Pin a supported Node LTS release, add engine guidance, document CachyOS/Linux
prerequisites, and add a Linux CI job for install, typecheck, and unit tests.
Preserve the current Electron development path.

Likely files: `package.json`, a Node version file, `README.md`, `.github/workflows/`.

## Acceptance

- Fresh Linux install uses the pinned toolchain.
- CI runs install, typecheck, and all unit tests.
- Native `better-sqlite3` setup is documented.
- Existing package overrides and unrelated lockfile changes are preserved.

Verify: `npm ci`, `npm run typecheck`, `npm test`.
