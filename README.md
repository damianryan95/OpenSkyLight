# OpenSkyLight

OpenSkyLight is a LAN-hosted household calendar service. One Node server owns
the SQLite database; Chromium kiosks show the wall display and parents manage
the household from a phone at `/admin/`.

## Run it

Node.js `22.13.1` is required. On CachyOS/Fish:

```fish
fnm use 22.13.1
npm ci
npm run build
npm run start:server
```

Open `http://localhost:3000/` for the kiosk and
`http://localhost:3000/admin/` for parent administration. Development starts
the server plus both Vite clients:

```fish
npm run dev
```

The kiosk and phone clients proxy API calls to `localhost:3000` while running
under Vite. For a browser smoke test, set Chrome explicitly:

```fish
set -lx OSL_CHROMIUM_PATH /opt/google/chrome/chrome
npm run test:kiosk-browser
```

## Docker

The service is designed for a trusted home LAN or VPN, not direct Internet
exposure. Copy the example and set the household timezone and a specific LAN
bind address:

```fish
cp compose.example.yaml compose.yaml
set -gx OSL_LISTEN_ADDRESS 192.168.1.25
set -gx OSL_HOUSEHOLD_TIMEZONE Australia/Perth
docker compose up --build
```

SQLite data is stored in the `openskylight-data` Docker volume. Keep that
volume on local storage; do not place SQLite WAL files on SMB or NFS. Health is
available at `/health/live` and `/health/ready`.

## Architecture

- Node 22 headless server with the sole SQLite connection
- Browser kiosk at `/`, authenticated as a registered display
- Phone-first parent administration at `/admin/`, authenticated by household
  PIN session
- Server-sent events for cache invalidation and sync status
- Pull-only Google Calendar cache; calendar editing is not supported

## Google Calendar

In the parent portal, open **Calendar**, enter the Google OAuth Web-client ID
and secret. Register the displayed
`https://…/api/v1/google/callback` URI in Google Cloud. No Docker secret mount
is needed. The OAuth configuration and refresh tokens are encrypted with an
automatically generated application key stored beside the SQLite database in
the persistent application volume, so syncing resumes after a server restart.

See [the target architecture](docs/target-architecture.md) and the deployment
guidance in `deployment/` for kiosk configuration. Before upgrading or
releasing, follow the [release checklist](docs/deployment/release-checklist.md).

## Verification

```fish
npm run typecheck
npm test
npm run build
npm run test:kiosk-browser
npm run test:kiosk-connectivity
npm run test:multi-display
```
