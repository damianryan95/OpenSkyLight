# OpenSkyLight

OpenSkyLight is a self-hosted household dashboard for a wall display. It
combines a read-only Google Calendar view with chores, star balances, rewards,
lists, meals, weather, and per-person views.

One server runs in your home. Any modern browser can be a kiosk; parents use a
phone-friendly administration site. There is no Electron application and no
database on the displays.

> OpenSkyLight is designed for one trusted household LAN or VPN. Do not expose
> it directly to the public Internet.

## Origin and credit

This project is a fork of [lowerygt/OpenSkyLight](https://github.com/lowerygt/OpenSkyLight),
the original OpenSkyLight project by **lowerygt**. Thank you to the upstream
project and its contributors for the foundation, ideas, and work that made this
fork possible.

This fork evolves that foundation into a LAN-hosted, browser-based household
service with a central server, parent phone administration, and registered wall
displays. Please visit and star the [upstream repository](https://github.com/lowerygt/OpenSkyLight).

## Screenshots

Would be great right about here

## What you need

- A Docker host that stays on (a small Linux server, VM, or NAS is ideal).
- Docker Engine with Docker Compose v2.
- A fixed LAN address or local DNS name for that host.
- A phone/browser for parent setup and one or more Chromium/Chrome browsers
  for displays.
- Optional: a Google Cloud project if you want Google Calendar sync.

The server is the only supported SQLite owner. Keep its Docker volume on local
disk—never SMB/NFS—and run only one OpenSkyLight server against that volume.

## How it fits together

```text
Parent phone ── /admin/ ──┐
                           ├── OpenSkyLight server + SQLite volume
Wall displays ──── / ─────┘              │
                                          └── read-only Google Calendar sync
```

- The kiosk at `/` starts in Family view. It can only complete or undo chores
  for the current household day.
- Parent administration at `/admin/` uses a household PIN and controls people,
  calendars, chores, rewards, lists, meals, and displays.
- Google Calendar remains the event editor and source of truth. OpenSkyLight
  only reads/caches Google events; it never edits them.
- Each display has its own private credential. A parent creates a one-time
  enrollment link; the browser stores the credential locally and removes the
  secret fragment from its address bar.

## Quick start with Docker

Run these commands on the Docker host or in a checked-out copy of this
repository. Examples use Fish.

```fish
git clone https://github.com/lowerygt/OpenSkyLight.git
cd OpenSkyLight
cp compose.example.yaml compose.yaml

# Replace with this host's fixed LAN address.
set -gx OSL_LISTEN_ADDRESS 192.168.1.25

# Use your household's IANA timezone—not UTC unless that is really correct.
set -gx OSL_HOUSEHOLD_TIMEZONE Australia/Perth

docker compose up -d --build
docker compose ps
curl --fail http://192.168.1.25:3000/health/ready
```

When the health check returns `{"status":"ready"}`, open:

- `http://192.168.1.25:3000/admin/` on a parent phone
- `http://192.168.1.25:3000/` on a display browser

The Compose defaults bind only to `127.0.0.1`; setting
`OSL_LISTEN_ADDRESS` is what makes the service reachable on the LAN. Prefer a
specific address rather than `0.0.0.0`.

### First parent setup

1. Open `/admin/` and choose a household PIN. This is required before changes
   can be made.
2. On **Home**, set the household location and IANA timezone (for example,
   `Australia/Perth`). This controls the date/time shown to every display and
   the date that kiosks may use for chores.
3. On **Household**, add parents and children. Each person can have a colour,
   avatar, and optional visual personalization.
4. On **Chores**, add recurring or one-off chores, rewards, and any starting
   star adjustments. Parents may correct historical completion; kiosks cannot.
5. On **Planning**, create lists and meals if wanted.

### Enroll each wall display

1. In `/admin/`, open **Displays** and choose **Register display**.
2. Name the screen and copy the enrollment link shown once.
3. Open that exact link in the browser on the wall display.
4. The kiosk saves its credential locally, strips the secret from the address
   bar, and returns to the Family view.

Treat an enrollment link as a password. Do not put it in a screenshot, chat,
shell history, or browser bookmark. If a display is lost, use **Revoke
display** in the parent site and register a replacement.

## Daily use

Tap a person’s avatar on a kiosk to switch between Family and personal views.
The kiosk is deliberately read-only except for today’s chore ticks. A chore
completion updates that person’s balance; a parent can also make a manual star
adjustment from **Chores → Adjust star balance**.

Use the parent site for all administration. The display cannot create events,
edit lists, change rewards, or alter past/future chore records.

## Google Calendar setup (optional)

Google integration needs a stable HTTPS hostname that works from the parent
phone and resolves to the server over the LAN/VPN—for example,
`https://calendar.example.net`. A local reverse proxy and split-horizon DNS
are common. Do not use a public port-forward merely for OpenSkyLight.

1. In Google Cloud, enable the Google Calendar API.
2. Configure a **Web application** OAuth client and the consent screen.
3. Add your domain as an authorized domain.
4. Register the exact callback displayed in the parent portal:
   `https://your-host/api/v1/google/callback`.
5. In `/admin/` → **Calendar**, enter the client ID/secret, complete the
   Google consent flow, then select the calendars to show.
6. Map each selected calendar to Family or a household member.

Events remain editable only in Google Calendar. Cached events remain visible
if Google is temporarily unavailable. Full OAuth requirements and security
details are in [the Google OAuth decision](docs/adr/0001-headless-google-oauth.md).

## Raspberry Pi / browser kiosk

Any current Chromium/Chrome browser can open the kiosk URL. The documented
unattended recipe uses Raspberry Pi OS Desktop 64-bit, X11, and Chromium with
autostart. Follow [the Raspberry Pi kiosk guide](docs/deployment/raspberry-pi-kiosk.md)
for installation, touch/power settings, and the real-device validation list.

Give the server a fixed DHCP lease or local DNS name so displays can reconnect
after reboots. Do not use a kiosk credential in a command line or config file;
enroll it through the parent site instead.

## Updating

Back up before an upgrade. For source deployments:

```fish
git pull
docker compose build
docker compose up -d --remove-orphans
docker compose ps
curl --fail http://192.168.1.25:3000/health/ready
```

The server runs database migrations before it reports ready. Keep the image
version and both web clients together; do not host a kiosk bundle separately
from a different server version.

For a remote Docker VM reached over SSH, the repository also includes a local
release helper. Configure a Docker context, then run:

```fish
npm ci
npm run deploy:home
```

It performs type checks/tests/builds, exports an online SQLite backup, ships
the image, starts Compose, and waits for readiness. See
[local home deployment](docs/deployment/local-home-deploy.md) for its target
and environment overrides.

## Backup and recovery

The SQLite database uses WAL mode. Do **not** copy the database, `-wal`, and
`-shm` files directly. Use the included online backup command instead:

```fish
mkdir -p backups
set -l stamp (date +%Y%m%dT%H%M%SZ)
set -l container (docker compose ps -q openskylight)
set -l image_tag dev # replace with the image currently deployed
docker run --rm --volumes-from $container -v "$PWD/backups:/backup" "openskylight:$image_tag" \
  node out/server/operations-cli.js backup /data/openskylight.db "/backup/openskylight-$stamp.db"
test -s "backups/openskylight-$stamp.db"; and echo backup-ok
```

Keep backups outside the Docker volume and protect them as household data. The
application data volume also contains the key needed to decrypt Google
configuration/tokens, so retain that volume securely too. Test restores only
into a new empty volume; the detailed restore procedure is in
[operations](docs/deployment/operations.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Phone/display cannot connect | Confirm the LAN address, port `3000`, Docker health, and that `OSL_LISTEN_ADDRESS` is set to the host’s LAN address. |
| Kiosk says a chore is for the wrong date | In `/admin/` → **Home**, verify the household IANA timezone. Reload the kiosk after changing it. |
| Display is unregistered | Register it again in **Displays** and open the new one-time enrollment link on that device. |
| Google events are missing | Check **Displays → Diagnostics**, then verify the Google account and calendar selection in **Calendar**. Cached events remain available during a temporary outage. |
| Manual stars do not appear immediately | The parent page shows the resulting balance; connected displays revalidate automatically. Check that the adjustment confirmation appeared. |
| Need logs | `docker compose logs -f --tail=200 openskylight` |

## Development

Node.js `22.13.1` is required.

```fish
fnm use 22.13.1
npm ci
npm run dev
```

The development command starts the server plus Vite clients. Core checks are:

```fish
npm run typecheck
npm test
npm run build
```

Browser tests also need a Chrome/Chromium path:

```fish
set -lx OSL_CHROMIUM_PATH (command -v chromium)
npm run test:kiosk-browser
```

For architecture and release work, see [target architecture](docs/target-architecture.md),
[operations](docs/deployment/operations.md), and the
[release checklist](docs/deployment/release-checklist.md).
