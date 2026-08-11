# Personalization prototype decisions

Status: PE01 interaction contract
Last reviewed: 2026-08-08

The development-only prototype is available while Vite is running at:

```text
/?prototype=personalization
```

It uses fixture data only. It does not create a server route, persist a theme,
upload media, or alter the kiosk’s actual viewing context.

## Reviewed states

The capture script produces deterministic prototype references:

- `kiosk-1280x800.png`, `kiosk-1920x1080.png`, and `kiosk-2400x900.png` show
  Ava’s Minecraft theme and the ordinary celebration;
- `phone-390x844.png` shows the phone-first theme gallery and celebration setup;
- `kiosk-1280x800-reduced-motion.png` shows the static success fallback.

Run the references with Node 22.13.1:

```fish
fnm use 22.13.1
npm run screenshots:personalization
```

The route is development-only. The capture script starts and stops Vite itself.

## Decisions locked for the next tickets

| Area | Decision |
| --- | --- |
| Context | Family retains the familiar warm theme. A person theme only appears after deliberately selecting that avatar; it never changes filtering or permissions. |
| Layout | Theme changes token/decorative treatment only. Header controls, avatar row, tile positions, card hierarchy, and 48 px touch targets do not move. |
| Theme transition | A 260 ms color/decorative cross-fade is allowed. Layout, scroll position, and selected view do not animate or reset. Reduced motion removes the transition. |
| Parent setup | Each person receives a single **Personalize** flow: theme gallery, celebration picker, preview, enabled state, and duration. Display colour mode stays under display settings. |
| Celebration surface | The overlay is pointer-transparent except for its optional preview-only dismiss control. Production completion remains actionable below the overlay. |
| Safe area | Celebration media stays contained in a centred area no larger than 76vw × 68vh (with 14–24 px viewport gutters on phone). Use `object-fit: contain`; never crop a transparent character animation. |
| Duration | Default is 3000 ms. Parent choices are 1500–5000 ms; the renderer ends playback regardless of an animation file’s loop setting. |
| Queue | Preserve FIFO order, deduplicate completion IDs, show at most three pending celebrations, then collapse additional events to one static “Great teamwork” summary. |
| Motion | `prefers-reduced-motion` and the kiosk motion preference show a static tick/star success card and do not fetch/decode animated bytes. |
| Loading/failure | Do not delay chore completion for media. Missing, slow, invalid, or unsupported media immediately uses the built-in static card. |
| Media | PNG, GIF, and WebP are the first formats. The parent UI recommends transparent WebP; server limits and byte inspection are PE05 work. |

## Accessibility review

- All prototype buttons have visible labels and a 48 px minimum height.
- Selected avatar/theme state is exposed with `aria-pressed`.
- The celebration announces completion through a polite, atomic status region.
- Reduced motion removes particle animation and pop transition.
- Prototype palettes use dark ink on pale surfaces or pale ink on the KPop
  surface; PE08 will add automated contrast coverage for every actual pack.

## Follow-up ownership

- PE02 owns the person settings, defaults, and API contracts.
- PE03 owns the production token runtime and initial-loading behavior.
- PE05 owns file validation and managed media access.
- PE06 owns the real phone setup and shared preview.
- PE07 owns event routing, queue cap, media lifecycle, and fallbacks.
