# OpenSkyLight contributor notes

- Start with `docs/target-architecture.md`, then use `docs/tickets/README.md`
  and the individual ticket files to understand planned and completed work.
- This is a Node 22 headless-server application. Electron has intentionally
  been retired; do not restore Electron main/preload code or Electron tooling.
- The primary developer uses Fish and `fnm`; use Node `22.13.1`. Prefer Fish
  examples in user-facing instructions.
- The repository may contain broad, uncommitted roadmap work. Preserve it and
  do not use reset/checkout to discard changes outside the task at hand.
- The kiosk is served at `/` and parent administration at `/admin/`. Keep the
  companion Vite base as `/admin/` so its assets cannot collide with kiosk
  assets at `/assets/`.
- A kiosk needs a registered display credential. Parent registration creates a
  private fragment-based enrollment link; the kiosk stores the credential
  locally and removes the fragment from its address bar. Do not put display
  credentials in query strings, logs, or server-rendered history.
- Core checks are `npm run typecheck`, `npm test`, and `npm run build`.
  Browser checks need a Chrome path via `OSL_CHROMIUM_PATH`.

See `docs/development-handoff.md` for the current completion state and the
remaining real-hardware validation.
