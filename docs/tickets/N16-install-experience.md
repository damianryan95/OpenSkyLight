# N16 - Install experience for a non-technical household

Status: planned
Depends on: the target device being chosen, and the application being
feature-stable. **Deliberately last** — see the scheduling note below.

## Scheduling (2026-09-22)

The mechanism is settled by ADR 0004. The build is deliberately deferred to the
back of the queue.

An appliance image is constructed around a particular application running on
particular hardware. Neither is settled: the app is still gaining features, and
the device is open and unlikely to be a Raspberry Pi. Building the image before
both are stable means building it twice, and the second build discards most of
the first.

Until then, Portainer and Compose remain the install path. That is acceptable
precisely because the only current user is the person who wrote it — the
moment anyone else installs this, that stops being true and this ticket becomes
urgent.

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

## The decision, already made

[ADR 0004](../adr/0004-bootable-appliance-image.md) selects a **prebuilt
bootable image**: write it to a USB stick or SSD, boot a small computer, finish
setup from the phone. An install script and a `.deb` were both considered and
rejected — they lower the barrier without removing it.

What remains open, and belongs to whoever picks this up:

- **Base OS and image build** — and how it is produced in CI rather than by
  hand.
- **Update mechanism**, for both the application and the operating system. ADR
  0004 names this as the main ongoing cost of the decision; design it rather
  than leaving it implicit.
- **First-boot behaviour** — what the household sees before any configuration
  exists, and how it connects to the network. Settle `N02` against the chosen
  device at the same time.

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
