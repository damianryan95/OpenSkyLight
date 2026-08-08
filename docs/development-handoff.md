# Development handoff

## Current state

The target headless architecture is implemented: a Node 22 server owns SQLite,
the browser kiosk is served at `/`, and parent administration is served at
`/admin/`. Docker builds both browser clients into the runtime image.

The local container is healthy at `http://localhost:3000`. Parent setup starts
at `http://localhost:3000/admin/`; register a display there and open its
private enrollment link in the kiosk browser. The URL fragment is deliberately
removed after the kiosk stores its credential.

The companion Vite base is `/admin/`. This is important: using `/assets/`
would make the kiosk static fallback answer companion asset requests and leave
the parent page blank.

All unit tests passed on Node 22.13.1 at the latest verification: 30 files,
155 tests. The Docker image also built successfully.

## Roadmap status

All original headless-refactor tickets through C04, O01, and O03 are marked
done. The only unfinished work in that original roadmap is real Raspberry Pi
evidence:

- `O02-pi-kiosk.md` is blocked until a Raspberry Pi 5 running Raspberry Pi OS
  Desktop 64-bit/X11 is available for the documented unattended kiosk,
  touchscreen, reconnect, and DPMS/blanking validation.
- `O04-release-hardening.md` is blocked only on that O02 evidence.

Do not claim either ticket complete without recording the actual hardware
results in the ticket evidence.

A new person-theme and chore-celebration extension is planned in
[`personalization-roadmap.md`](personalization-roadmap.md). PE01 is ready; PE02
through PE10 remain planned behind their documented dependencies. This extension
does not make O02 or O04 complete.

## Local development

The developer uses Fish and `fnm`. For a fresh terminal:

```fish
fnm use 22.13.1
npm test
```

Docker defaults to a loopback-only bind. To test from a phone or kiosk on the
LAN, use a specific LAN address rather than exposing the service publicly:

```fish
set -gx OSL_LISTEN_ADDRESS 192.168.1.25
docker compose up -d --build
```

Use the machine's current LAN address if it differs. Google Calendar is
optional for first-run testing; the kiosk and household administration should
work without it.
