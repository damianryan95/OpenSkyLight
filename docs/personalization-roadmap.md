# Person themes and chore celebrations

Status: proposed product direction, decomposed for implementation  
Last updated: 2026-08-08

## 1. Outcome

OpenSkyLight should feel personal when a household member deliberately selects
their avatar, without making the shared family dashboard confusing or less
usable. The feature has two related but independent parts:

- a person theme changes the visual atmosphere of the kiosk while that person's
  viewing context is active;
- a person celebration briefly rewards that person's newly completed chore.

The existing `family | person:<id>` viewing context is the source of truth. This
is personalization, not authentication: selecting a child never grants new
permissions.

## 2. UX direction

### Themes

Family view keeps the current warm OpenSkyLight theme. Selecting a person may
apply their chosen theme pack to the whole display background, decorative
elements, accent treatment, cards, and selected typography details. Content
hierarchy, tile positions, navigation, and touch behavior remain stable, so a
child does not have to relearn the dashboard.

Theme packs may directly reflect the interests selected by the household. The
initial directions are:

- **Minecraft**: block geometry, grass/stone colors, pixel accents, and optional
  parent-supplied character or background artwork;
- **Frozen**: frosted blues, snow crystals, storybook light, and optional
  parent-supplied character artwork;
- **KPop Demon Hunters**: concert neon, celestial/demon-hunter symbols, energetic
  gradients, and optional parent-supplied character artwork.

This is a personal household deployment, so the product does not need to
genericize franchise names or enforce a licensing workflow. Assets should still
be stored locally, optimized for the Raspberry Pi kiosk, and included in backup
and restore behavior.

Theme choice belongs to a person, not a display. The same child therefore gets
the same identity on every kiosk. Existing display `light | dark | auto` remains
an orthogonal color-mode preference; every theme must define accessible light
and dark variants. A missing, deleted, or invalid theme falls back to the
OpenSkyLight default without a blank or partially styled screen.

The first release should use curated packs. A later safe theme composer may let
parents choose from bounded colors, textures, and decorations. Uploaded CSS,
HTML, JavaScript, fonts, and arbitrary theme archives are out of scope.

### Celebrations

A celebration appears only after the completion transaction succeeds and, by
default, only on the kiosk that initiated it. It should:

- show the child's name, earned stars, and their selected animation;
- last roughly 2–4 seconds and never prevent another chore tap;
- use `object-fit: contain`, preserve transparency/aspect ratio, and stay inside
  a viewport-safe region at all supported kiosk sizes;
- be dismissible by time and safe to ignore if rendering fails;
- replace motion with a calm static success card when reduced motion is set;
- have no sound in the initial release.

The parent experience should be “upload, preview, assign, save,” with a built-in
celebration always available. Accept PNG, animated GIF, and animated/static WebP
initially. GIF is useful for easy sourcing, but it has weak transparency and can
be very large; the UI should recommend WebP for better results.

An upload is not trusted merely because of its extension or browser MIME type.
The server must inspect bytes and decoded metadata, reject malformed or excessive
images, and never accept SVG. Initial limits should be explicit and testable:
10 MB stored bytes, 2048 x 2048 decoded dimensions, and no more than 300 frames.
The overlay duration is controlled by OpenSkyLight (1.5–5 seconds), not by an
unbounded animation loop.

Rapid completions should remain FIFO but cap the visible backlog at three. Extra
events can collapse into a final “Great teamwork” summary instead of forcing the
family to watch a long queue.

## 3. Information architecture

Add a **Personalize** action to each person in parent administration. Its mobile
flow contains:

1. a theme gallery with live sample cards and light/dark previews;
2. a celebration picker with the built-in fallback and uploaded media;
3. an in-page preview using the same rendering component as the kiosk;
4. motion and duration controls, with clear file guidance and validation errors.

Do not place person themes under display settings. Display settings continue to
own hardware/location concerns such as color mode, layout, and sleep schedule.

## 4. Domain and storage

Use stable IDs rather than persisting CSS class names or file paths:

```text
people
  theme_id nullable -> bundled/custom theme registry ID
  celebration_asset_id nullable -> media_assets.id
  celebration_duration_ms
  celebration_enabled

media_assets
  id, kind, original_name, media_type, byte_size
  width, height, frame_count, sha256, storage_key
  created_at, deleted_at

custom_themes (later phase)
  id, name, validated token JSON, optional media asset references
```

Media bytes live in a managed directory under the persistent data volume, not
inside SQLite and not as data URLs. Database records and files must be updated
with compensating cleanup so failed operations do not leave broken references.
Backups and restores must include both the SQLite snapshot and managed media.

Display endpoints expose only the active person's validated personalization and
an authenticated media-fetch route. Clients create and revoke object URLs; raw
filesystem paths are never returned. Parent APIs own upload, assignment, and
deletion. An asset cannot be physically removed while still referenced.

## 5. Theme runtime contract

Theme packs are typed, versioned manifests bundled with the kiosk. They map to a
bounded semantic token surface, for example background, card, text, muted text,
line, accent, success, radii, shadows, pattern, and decorative layer. The app
applies a theme using a root `data-person-theme` value and CSS custom properties.

Theme application order is:

```text
base OpenSkyLight tokens
  -> selected person theme tokens (personal view only)
  -> display light/dark/auto variant
  -> accessibility/user-agent overrides
```

Theme changes should cross-fade subtly without animating layout. They must not
cause a flash of the wrong theme during initial data loading, leak into the
parent app, or affect print/error/registration screens.

Every pack must pass WCAG AA contrast for ordinary text, visible focus states,
48 px touch targets, reduced-motion behavior, and the existing 1280x800,
1920x1080, and 2400x900 visual checks.

## 6. Delivery roadmap

### Phase A — contract and foundation

- **PE01** validates the interaction contract with deterministic prototypes.
- **PE02** adds person personalization persistence and typed APIs.
- **PE05** adds safe managed image upload and delivery.

### Phase B — useful first release

- **PE03** implements the context-aware theme engine.
- **PE04** adds the phone-first theme assignment flow.
- **PE07** replaces the celebration placeholder with the resilient renderer.
- **PE06** adds celebration upload, assignment, and preview.
- **PE08** supplies the Minecraft, Frozen, and KPop Demon Hunters starter themes
  and built-in fallback celebrations.

This phase is the recommended release boundary. It gives each child a distinct
experience without requiring parents to become designers.

### Phase C — bounded customization

- **PE09** adds the optional safe theme composer after curated packs have been
  used and usability feedback is available.

### Phase D — hardening and rollout

- **PE10** completes accessibility, visual/performance, backup, multi-display,
  and real-hardware validation.

## 7. Dependency graph

```text
PE01 -> PE02
PE01 + PE02 -> PE03 -> PE04
PE01 + PE02 -> PE05 -> PE06
PE01 + PE02 + PE05 -> PE07
PE01 + PE03 -> PE08
PE03 + PE04 + PE05 + PE08 -> PE09 (optional)
PE04 + PE06 + PE07 + PE08 (+ PE09 if shipped) -> PE10
```

PE03 and PE05 can run in parallel after their dependencies. PE04 and PE06 touch
the people administration UI and should not run concurrently without explicit
file ownership. PE07 and PE08 can proceed independently once their contracts are
stable.

## 8. Success measures

- A child can select their avatar and recognize their personal view within one
  second, while Family view remains visually familiar.
- A parent can assign a theme and upload/preview a celebration from a phone
  without reading technical image guidance.
- Chore completion remains successful if media is missing, corrupt, slow, or
  unsupported by the kiosk browser.
- Theme switching does not shift layout or reduce readable contrast.
- First personalized kiosk render adds no more than 200 ms p95 scripting time on
  the Raspberry Pi target; celebration playback stays responsive without
  unbounded memory or queue growth.
- Every user-generated asset can be identified, backed up, restored, replaced,
  and safely deleted.

## 9. Deliberate non-goals

- arbitrary CSS/HTML/JavaScript or downloadable theme archives;
- theme-specific information architecture or different tile layouts per child;
- sound, video, remote asset URLs, or third-party animation marketplaces;
- turning avatar selection into authentication or permissions;
- broadcasting celebrations to every display by default.
