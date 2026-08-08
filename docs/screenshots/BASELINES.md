# Kiosk visual baselines

Regenerate the protected display references after reviewing an intentional visual
change:

```sh
npm run build
npm run screenshots:baseline
```

The command uses a fresh temporary Electron profile and seeded local data. It
waits for the Nunito Variable and Fraunces Variable fonts, disables screenshot
animations, and captures the Home route at `1280x800`, `1920x1080`, and
`2400x900`. It does not call weather, news, Google, or other network services.

The protected visual system is defined in `src/shared/styles/tokens.css`:
Fraunces and Nunito typography; paper/linen and ember color tokens; card and
floating shadows. Existing baseline files require the explicit `--update` flag
used by the npm command, so changes remain visible in source control review.

For stability verification, run the command twice and compare image dimensions
and hashes (the PNG bytes are expected to match on the same Chromium build):

```sh
npm run screenshots:baseline
identify docs/screenshots/baselines/*.png
sha256sum docs/screenshots/baselines/*.png
```
