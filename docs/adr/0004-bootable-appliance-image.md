# ADR 0004: Ship OpenSkyLight as a bootable appliance image

**Status:** Accepted (direction set by the project owner, 2026-09-22)
**Date:** 2026-09-22
**Decision owner:** project owner

## Context

Until now there has been exactly one way to install OpenSkyLight: provision
Docker, add a Portainer Repository stack, set four environment variables
correctly, and hope the build succeeds.

A single evening of real deployment produced a corrupt BuildKit cache that
failed with an opaque exit code, a misleading out-of-memory diagnosis, a schema
version mismatch that required deleting a volume by hand, and a display
enrolment link that could not be moved between devices. Every one of those
would permanently end a non-technical household's attempt, and none of them is
the user's fault.

The product's first principle is that the target operator is a non-technical
household member, and that a step requiring a cloud console, a client secret or
a terminal is a defect rather than a prerequisite. The install path was the
largest remaining violation of that principle.

## Decision

Ship a **prebuilt bootable image**: the household writes it to a USB stick or
SSD, boots a small computer from it, and completes setup from their phone.

Considered and rejected:

- **An install script** — one command on a prepared Debian or Ubuntu machine.
  Much less work to build and maintain, but it still assumes the user can
  install an operating system, reach a terminal, and understand what they are
  pasting. That is a smaller barrier, not an absent one.
- **A distribution package** (`.deb`) — familiar to Linux users and invisible
  to everyone else. Solves the problem for people who did not have it.

The bootable image is more work and takes on responsibility for operating
system updates for the life of the product. It is chosen anyway because it is
the only option where the user never meets a terminal, and because the
alternatives leave the actual barrier standing.

**Portainer and Compose remain supported and documented** as the path for
technical users. They stop being the only path.

## Consequences

- **Images are pulled, never built on the device.** The existing release
  workflow already publishes to `ghcr.io` on a version tag; that becomes
  structural rather than a convenience. A small computer should not be running
  a C++ toolchain, and tonight demonstrated what happens when it does.
- **Upgrades become the product's responsibility**, including across schema
  changes. The manual volume deletion this project has relied on is not
  acceptable in a shipped appliance.
- **Environment variables stop being a user-facing concept.** The distinction
  between `OSL_SERVER_HOST` and `OSL_LISTEN_ADDRESS` is internal, has already
  caused a silent crash loop, and must never reach a household.
- **OS update policy has to be owned.** An appliance that never updates becomes
  a liability on a home network. This is the main ongoing cost of the decision
  and should be designed, not left implicit.
- **The target device stays open** and is unlikely to be a Raspberry Pi; an x86
  mini PC is the probable shape. The image must not hard-code Raspberry Pi
  assumptions, and `deployment/raspberry-pi/` remains one recipe among several.

## Timing (recorded 2026-09-22)

This decision stands; its implementation is deliberately scheduled last. An
image is built around a specific application on specific hardware, and neither
is settled yet. `N16` carries the reasoning and the conditions for starting.

The decision is recorded now anyway because it shapes earlier work — chiefly
that releases must publish pullable images rather than expecting the device to
build them, which is already true of the release workflow.

## Follow-up

`N16` implements this and owns the remaining choices: base OS, update
mechanism, first-boot behaviour, and how the image is produced in CI.
`N02`'s access-point pairing should be settled against the chosen device
rather than rewritten speculatively.
