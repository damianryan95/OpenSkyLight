# PE03 - Build the context-aware theme engine

Status: done
Depends on: PE01, PE02

## Context

Read personalization roadmap sections 1–2 and 5. Read target architecture
section 8/Kiosk display and inspect the existing `useTheme` color-mode behavior.

## Deliverable

Create a typed, versioned theme-pack registry and apply semantic CSS variables
from the current `family | person:<id>` viewing context. Family uses the existing
OpenSkyLight tokens. Personal themes layer below the display's existing
light/dark/auto decision and must define both variants.

Keep layout, component semantics, and companion styles stable. Add a subtle
reduced-motion-aware cross-fade that does not animate geometry or flash an
incorrect theme while people/settings load.

Likely files: shared theme types/registry, renderer theme hook/provider, token
CSS, viewing-context integration, component/visual tests.

## Acceptance

- Selecting a themed person applies their pack; selecting Family restores the
  neutral theme; relaunch still begins in Family.
- Light, dark, and auto continue to work for every pack.
- Missing/malformed packs atomically fall back to the default token set.
- Theme state never changes permissions, filtering, tile geometry, admin UI, or
  registration/error screens.
- No arbitrary CSS, markup, script, remote URL, or unbounded token value can
  enter the document.
- Theme switching respects `prefers-reduced-motion` and has component and visual
  regression coverage.

Verify: theme registry/unit tests, viewing-context browser journey, existing
theme tests, visual baselines, typecheck, and build.
