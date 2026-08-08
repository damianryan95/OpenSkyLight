# PE08 - Create the starter personalization packs

Status: planned  
Depends on: PE01, PE03

## Context

Read personalization roadmap sections 2, 5, 8, and 9. Use the visual contract
approved in PE01.

## Deliverable

Create three bundled theme packs—Minecraft, Frozen, and KPop Demon
Hunters—plus a neutral built-in celebration fallback. Use code-native CSS/SVG
decoration where appropriate and optimized local raster assets, including
parent-supplied franchise artwork, where they improve the result.

Each pack must support light/dark color modes, ultrawide and 16:9 viewports,
reduced motion, and the complete kiosk component inventory rather than only the
home screen.

Likely files: theme manifests/tokens, local decorative assets, visual fixtures,
screenshots and attribution/source notes.

## Acceptance

- All three packs are recognizably different while preserving OpenSkyLight's
  hierarchy, navigation, layout, and touch behavior.
- Every text/surface/focus combination used by the kiosk meets WCAG AA contrast.
- Assets are inventoried, optimized, local, usable offline, and included in
  backup/restore expectations.
- Decorations do not obscure content, create visual noise behind dense calendar
  views, or shift layout while loading.
- Each pack passes every supported viewport in light, dark, and reduced-motion
  modes.

Verify: automated contrast assertions where possible, asset size/source audit,
visual regression matrix, typecheck, and build.
