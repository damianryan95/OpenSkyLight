# Platform Support Roadmap

## Scope

This roadmap assumes the following product direction:

- Primary development and day-to-day testing happen on Linux amd64.
- The long-term kiosk target is Raspberry Pi on Linux arm64.
- The RTSP camera feature is not important and can be removed to reduce platform and dependency complexity.

The goal is not just to "make Electron run on Linux". The goal is to make OpenSkyLight a Linux-first app that is easy to develop on amd64 and practical to deploy on a Pi.

## Recommended Target Matrix

- Dev/test: Linux amd64, windowed and kiosk modes.
- First deployment target: Raspberry Pi 5, Linux arm64, 64-bit OS.
- Deferred: Windows parity for every kiosk/platform feature.
- Deferred: Pi 4 as an explicitly supported performance target.

## Key Decisions

1. Remove the camera feature early.
2. Treat Raspberry Pi as a Linux arm64 packaging/runtime target, not as a special fork.
3. Make Linux the primary supported desktop platform before worrying about polished Pi deployment.
4. Disable or no-op installer-driven auto-update on Linux first, then revisit later.

## Why Removing Camera First Helps

Removing camera support simplifies several current pain points at once:

- It removes the ffmpeg runtime dependency from [package.json](../package.json#L32).
- It removes the renderer-side MPEG-TS player dependency and its transitive GitHub-based package chain.
- It removes a performance-sensitive feature that is the most likely to behave differently between amd64 desktops and Raspberry Pi.
- It eliminates one native/process-heavy subsystem from the initial Linux/Pi support effort.

In practice, camera removal is the highest-leverage simplification available.

## Phase 0: Stabilize Linux Development Baseline

### Objectives

- Make a fresh setup on Linux amd64 work without manual recovery steps.
- Standardize the Node/Electron toolchain so development and CI are reproducible.
- Establish Linux as a first-class supported development platform.

### Work

- Pin the project to an LTS Node version, ideally Node 22.
- Add an explicit version file such as `.nvmrc` or a Volta config.
- Add `engines` guidance in [package.json](../package.json).
- Ensure `npm install` works on Linux without requiring manual Electron binary installation.
- Ensure `npm install` works under stricter npm policies or remove the dependency chain that triggers those policies.
- Document Linux prerequisites in [README.md](../README.md).
- Add a Linux amd64 CI job for install, typecheck, and unit tests.

### Files Likely Touched

- [package.json](../package.json)
- [package-lock.json](../package-lock.json)
- [README.md](../README.md)
- CI workflow files under `.github/`

### Acceptance Criteria

- Fresh clone on Linux amd64 installs cleanly.
- `npm run dev:windowed` works without manual Electron repair.
- `npm test` and `npm run typecheck` pass on Linux amd64 CI.

## Phase 1: Remove Camera Feature End-to-End

### Objectives

- Eliminate camera-specific runtime, UI, IPC, and dependency surface.
- Preserve app stability for users who may already have camera tiles configured.

### Work

- Remove the `camera` tile type from shared tile definitions and config validation.
- Remove camera IPC channels and schemas.
- Remove the camera service and ffmpeg spawning logic.
- Remove the renderer camera tile component and picker UI.
- Remove camera settings UI and any text/documentation describing camera support.
- Audit whether `ws` remains needed after camera removal; remove it if not used elsewhere.
- Remove `ffmpeg-static` and `mpegts.js` from dependencies.
- Add a migration or load-time sanitizer that removes stale `camera` tiles from saved home layouts.

### Files Likely Touched

- [package.json](../package.json)
- [src/main/index.ts](../src/main/index.ts)
- [src/main/ipc/router.ts](../src/main/ipc/router.ts)
- [src/main/services/cameraService.ts](../src/main/services/cameraService.ts)
- [src/main/services/cameraArgs.ts](../src/main/services/cameraArgs.ts)
- [src/shared/ipc/contract.ts](../src/shared/ipc/contract.ts)
- [src/shared/ipc/schemas.ts](../src/shared/ipc/schemas.ts)
- [src/shared/types/index.ts](../src/shared/types/index.ts)
- [src/shared/home.ts](../src/shared/home.ts)
- [src/preload/index.ts](../src/preload/index.ts)
- [src/renderer/src/features/home/tiles.tsx](../src/renderer/src/features/home/tiles.tsx)
- [src/renderer/src/features/home/tileRegistry.tsx](../src/renderer/src/features/home/tileRegistry.tsx)
- [src/renderer/src/features/home/AddTileSheet.tsx](../src/renderer/src/features/home/AddTileSheet.tsx)
- [src/renderer/src/features/settings/SettingsSheet.tsx](../src/renderer/src/features/settings/SettingsSheet.tsx)
- [README.md](../README.md)

### Acceptance Criteria

- No camera UI remains.
- Existing saved layouts with camera tiles do not crash the app.
- `ffmpeg-static` and `mpegts.js` are gone from the dependency graph.
- Linux install becomes simpler and more reliable than the current baseline.

## Phase 2: Introduce a Platform Integration Layer

### Objectives

- Separate Electron-generic application logic from OS-specific kiosk behavior.
- Keep Linux amd64 and Linux arm64 on the same code path wherever possible.

### Work

- Create a small platform abstraction layer in `src/main/platform/`.
- Move startup registration behind an interface.
- Move updater behavior behind an interface.
- Move display sleep/power integration behind an interface where necessary.
- Keep `safeStorage` use, but make fallback behavior explicit in code and docs.

### Platform Concerns To Isolate

- Autostart: currently wired through [src/main/kiosk/kiosk.ts](../src/main/kiosk/kiosk.ts#L127).
- Display sleep prevention: currently wired through [src/main/kiosk/kiosk.ts](../src/main/kiosk/kiosk.ts#L89).
- Idle detection: currently uses [src/main/kiosk/kiosk.ts](../src/main/kiosk/kiosk.ts#L105).
- Auto-update: currently implemented in [src/main/updater.ts](../src/main/updater.ts).
- Secret storage fallback: used in [src/main/sync/googleAuth.ts](../src/main/sync/googleAuth.ts#L21) and [src/main/services/cameraService.ts](../src/main/services/cameraService.ts#L38).

### Recommended First Cut

- `platform/autostart.ts`
- `platform/updater.ts`
- `platform/power.ts`

Each should have at least:

- a Linux implementation
- a no-op development-friendly implementation where needed

### Acceptance Criteria

- Main boot logic in [src/main/index.ts](../src/main/index.ts) no longer directly decides platform-specific behavior beyond selecting an implementation.
- Linux-specific behavior is concentrated in one place.
- Pi support no longer implies scattering `if (process.platform === 'linux')` across unrelated files.

## Phase 3: Make Linux Packaging a First-Class Path

### Objectives

- Support packaged Linux builds for amd64 and arm64.
- Stop assuming Windows-only distribution.

### Work

- Extend [electron-builder.yml](../electron-builder.yml) with Linux targets.
- Start with AppImage and/or deb.
- Add amd64 Linux packaging first.
- Add arm64 Linux packaging second.
- Validate native modules in packaged Linux builds.
- Decide whether Linux packaged builds ship with updater disabled.

### Notes

Current packaging config is Windows-only in [electron-builder.yml](../electron-builder.yml#L16). That should change only after camera removal and Linux baseline stabilization, otherwise packaging work will be debugging the wrong problems.

### Acceptance Criteria

- A packaged Linux amd64 build launches cleanly.
- A packaged Linux arm64 build is produced by CI or a documented build process.
- The packaged app can read/write its SQLite DB under the normal Electron `userData` path used in [src/main/index.ts](../src/main/index.ts#L55).

## Phase 4: Linux UX and Text Cleanup

### Objectives

- Remove Windows assumptions from the user-facing product.
- Make settings/help text correct for Linux users.

### Work

- Replace Windows-only setup text in [README.md](../README.md).
- Replace the Windows Firewall note in [src/renderer/src/features/settings/SettingsSheet.tsx](../src/renderer/src/features/settings/SettingsSheet.tsx#L1016) with Linux-neutral wording.
- Review any startup, fullscreen, or installer text for Windows-only assumptions.
- Document Linux kiosk setup recommendations.

### Acceptance Criteria

- A Linux user can follow the docs without hitting Windows-only dead ends.
- Settings text is platform-neutral unless the app actually detects and displays a platform-specific note.

## Phase 5: Raspberry Pi Deployment Pass

### Objectives

- Validate that the Linux-first app also works on Raspberry Pi arm64.
- Limit the Pi-specific work to deployment and performance tuning.

### Work

- Test on a real Pi 5 with a 64-bit OS.
- Validate packaged startup, fullscreen behavior, and touch input.
- Validate screensaver, sleep schedule, companion app, and sync features.
- Measure performance of the default dashboard and the heaviest realistic dashboard.
- Decide whether to recommend SSD boot/storage instead of SD card for kiosk durability.
- Choose one supported kiosk startup method for Pi, preferably systemd or an XDG autostart path, and document it.

### Acceptance Criteria

- Pi can boot into the app reliably.
- Core app features are stable without platform-specific code forks.
- Any Pi-specific compromises are documented and deliberate.

## Phase 6: Test and Migration Hardening

### Objectives

- Keep future Linux and Pi support from regressing.
- Make feature removal safe for existing user data.

### Work

- Add unit coverage for home-layout sanitization after camera removal.
- Add tests for platform service selection.
- Add Linux-focused smoke coverage for packaged or dev runs.
- Add a migration note for users coming from camera-enabled builds.

### Acceptance Criteria

- Existing settings/home layout data from older builds does not break the app.
- Linux support is enforced in CI, not remembered socially.

## Recommended Execution Order

1. Stabilize Linux amd64 development baseline.
2. Remove camera feature completely.
3. Add platform integration seams.
4. Add Linux packaging.
5. Clean up Linux-facing docs and UI text.
6. Validate on Raspberry Pi.
7. Backfill tests and migration coverage.

## Open Decisions

These should be resolved before implementation starts in earnest:

2. Should Linux builds ship with auto-update disabled for the first release?
3. Is Raspberry Pi support limited to Pi 5, 64-bit OS, and one display stack, or do you want to support weaker/older Pi hardware too?
4. Do you want to keep Windows support as a non-primary platform, or is the project explicitly moving to Linux-first?

## Suggested First Milestone

If the goal is to make real progress with the least risk, the first milestone should be:

- Node/toolchain pinning
- Linux install cleanup
- full camera feature removal
- Linux amd64 CI

That milestone removes the most fragility while also making the later Pi work much more predictable.
