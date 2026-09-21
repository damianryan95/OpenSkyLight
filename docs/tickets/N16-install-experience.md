# N16 - Install experience for a non-technical household

Status: planned
Depends on: a distribution decision (see below)

## Context

Read `docs/phone-first-roadmap.md` section 2, product principle 1. Read
`README.md`'s current Quick start, which is the thing this ticket replaces for
most people.

Today there is exactly one way to install OpenSkyLight: provision Docker, add a
Portainer Repository stack, set four environment variables correctly, and hope
the build succeeds. A single evening of real deployment produced a corrupt
build cache, a misleading out-of-memory diagnosis, a schema-version mismatch
requiring manual volume deletion, and an enrolment link that could not be moved
between devices. Every one of those would end a non-technical household's
attempt permanently.

The owner's direction (2026-09-22): the product becomes **a polished
self-hosted application running on a small computer**, with **Portainer kept as
a deployable option for the more technical individual**. Portainer is therefore
the advanced path, not the default — and no default currently exists.

## The decision this needs first

The distribution mechanism is not chosen. The credible options, with the
trade-off that actually separates them:

- **A prebuilt bootable image** — flash to a USB stick or SSD, boot, configure
  from the phone. The Home Assistant model. Best experience by a distance;
  most work to build and maintain, and it owns OS updates forever.
- **An install script** — one command on a fresh Debian/Ubuntu box that
  installs the runtime, fetches a published image, and registers a service.
  Far less work; still assumes the user can reach a terminal once.
- **A distribution package** (`.deb`) — familiar to Linux users, invisible to
  everyone else.

Produce an ADR choosing one before building. The choice is not obvious and
should not be made implicitly by whoever picks the ticket up.

## Deliverable

Whatever the ADR selects, the result must satisfy:

- **A household installs without a terminal**, or with exactly one copy-pasted
  command and nothing else.
- **No environment variables to reason about.** `OSL_SERVER_HOST` versus
  `OSL_LISTEN_ADDRESS` is an internal distinction that has already caused a
  silent crash loop; it must never reach a user.
- **The image is pulled, not built.** Published releases (`ghcr.io`, via the
  existing release workflow) rather than compiling on the target — a small
  computer should not be running a C++ toolchain.
- **Upgrades are a normal, safe action**, including schema changes. Tonight's
  manual volume deletion is exactly what this must prevent.
- **Portainer and Compose remain documented and supported** for technical
  users, with the current guide kept rather than deleted.

Likely files: new deployment tooling, `README.md`, `docs/deployment/*`, the
release workflow.

## Acceptance

- Someone who has never used Docker gets a working board on a small computer,
  following documentation that never mentions Docker.
- A technical user can still deploy via Portainer or Compose, unchanged.
- An upgrade across a schema change preserves household data without manual
  intervention.
- No step requires editing a compose file or setting an environment variable.

Verify: a genuine cold install on a wiped machine, performed without
consulting the source; plus an upgrade across a migration with data present.

## Note on hardware

The target device is deliberately open and is **unlikely to be a Raspberry Pi**
(2026-09-22). An x86 mini PC is the probable shape, which removes the arm64
cross-build problem entirely and gives room to run the server and a browser on
one machine. Do not hard-code Raspberry Pi assumptions into whatever this
produces; `deployment/raspberry-pi/` stays as one supported recipe among
several.
