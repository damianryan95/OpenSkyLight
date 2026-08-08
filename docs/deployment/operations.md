# OpenSkyLight server operations

OpenSkyLight is a **single active-server** household service. Its SQLite volume
is local to one Docker host and must not be shared through NFS, SMB, or a second
container/server. The application is LAN/VPN-only; do not publish it to the
public Internet.

## Logs and Google Calendar sync

Follow the structured container logs with:

```fish
docker compose logs -f --tail=200 openskylight
```

Google synchronization writes `google.sync.started`,
`google.sync.calendar_succeeded`, `google.sync.calendar_failed`, and
`google.sync.completed` entries. These identify the local calendar and whether
it changed, but deliberately omit provider response text, authorization codes,
tokens, and request URLs. Use the **Diagnostics** section in `/admin/` for the
last attempt and success time plus safe per-calendar error state.

Use immutable image tags such as `0.8.0`, never `latest`, when deploying a
release. The running image exposes its tag through the `org.opencontainers.image.version`
label and writes `releaseVersion` in the `server.started` structured log.

## Backup

The backup command uses SQLite's online backup API. Do not copy the `.db`,
`-wal`, and `-shm` files yourself: that can produce an inconsistent snapshot.
Backups may run while the one server is healthy. Store the exported files on
local storage outside the Docker volume and protect them like household data.

In Fish, create a backup directory and snapshot the named volume using the
current immutable image:

```fish
mkdir -p backups
set -l stamp (date +%Y%m%dT%H%M%SZ)
set -l container (docker compose ps -q openskylight)
set -l image_tag dev # replace with the deployed immutable tag, e.g. 0.8.0
docker run --rm --volumes-from $container -v "$PWD/backups:/backup" "openskylight:$image_tag" \
  node out/server/operations-cli.js backup /data/openskylight.db "/backup/openskylight-$stamp.db"
```

Confirm the resulting file is present before treating a backup as successful:

```fish
test -s "backups/openskylight-$stamp.db"; and echo backup-ok
```

## Restore and recovery drill

Restore only into a **new, empty Docker volume**. The restore command refuses
to overwrite a database path, protecting both the running database and its
pre-upgrade backup. Stop the server first; never restore while it is running.

```fish
set -l backup backups/openskylight-20260804T000000Z.db
set -l restore_volume openskylight-restore-test
set -l image_tag 0.8.0 # use the version that created the backup
docker volume create $restore_volume
docker run --rm -v "$PWD/backups:/backup:ro" -v "$restore_volume:/data" "openskylight:$image_tag" \
  node out/server/operations-cli.js restore "/backup/"(basename $backup) /data/openskylight.db
docker run --rm -v "$restore_volume:/data" "openskylight:$image_tag" \
  node out/server/operations-cli.js inspect /data/openskylight.db
```

To prove readiness, temporarily set `OSL_DATABASE_PATH` to that restored
volume in a separate Compose project and wait for `docker compose ps` to report
`healthy`. Delete the test volume only after the recovery drill is recorded:

```fish
docker volume rm $restore_volume
```

## Upgrade and rollback

1. Choose a maintenance window and confirm the current container is healthy.
2. Create and export a backup using the exact currently-running image tag.
3. Set `OSL_IMAGE_TAG` to the new immutable version, pull/build it, then run
   `docker compose up -d --remove-orphans`.
4. Migrations execute before the server binds its port; a failed migration exits
   the process and therefore never reports `/health/ready`.
5. Confirm `docker compose ps` is healthy and inspect the `server.started` log
   for the expected `releaseVersion`.

Rollback is safe only when the old image supports the database schema left by
the newer image. Because migrations are forward-only, the reliable rollback is:
stop the server, create a new clean volume, restore the pre-upgrade backup, and
start the previous immutable image against that volume. Do not point two
containers at either volume during this process.

## Volume ownership

`openskylight-data` is owned by Docker and mounted only at `/data` in the one
server container. Keep host backup files outside that volume. Docker's named
volume permissions are managed by the container runtime; do not `chown` files
inside a live volume from the host. If ownership or storage is changed, stop
the single server, make a verified backup first, and validate restore/readiness
on a new volume before the next upgrade.
