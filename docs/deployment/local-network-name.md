# Local network name

Ticket: [`N03`](../tickets/N03-local-network-name.md)

A parent should never have to know their server's IP address. This gives the
household a name to type instead — `http://openskylight.local:6123/admin/` —
while the numeric address keeps working exactly as before.

## How this actually works

The name is answered by the **host**, not by OpenSkyLight's container.

Raspberry Pi OS and most Debian-based systems run `avahi-daemon`, which
advertises `<hostname>.local` on the LAN over multicast DNS. Name the host
`openskylight` and `openskylight.local` resolves to it — no application
involvement at all.

A phone then connects to `openskylight.local:<published port>`, and Docker's
published port forwards to the container as it already does. Nothing about the
container's networking changes, and OpenSkyLight needs no mDNS library:

```text
phone  --- "openskylight.local?" --->  LAN multicast
       <-- "that's 192.168.1.41" ---   avahi-daemon on the host
       --- HTTP to 192.168.1.41:6123 -> Docker published port -> container
```

A bridge-networked container cannot answer LAN multicast, which is why this is
host configuration rather than something the server does. Switching the
container to host networking to work around that would trade away the port
isolation the deployment relies on, for no gain.

## Setup

### 1. Name the host

```fish
sudo hostnamectl set-hostname openskylight
```

Reboot, or restart Avahi so it re-advertises:

```fish
sudo systemctl restart avahi-daemon
```

### 2. Confirm Avahi is running

Raspberry Pi OS Desktop ships it enabled. If the name does not resolve:

```fish
sudo apt-get install -y avahi-daemon
sudo systemctl enable --now avahi-daemon
```

### 3. Optional — publish a service record

Copy [`deployment/raspberry-pi/openskylight.avahi-service`](../../deployment/raspberry-pi/openskylight.avahi-service)
to `/etc/avahi/services/openskylight.service` and set the port to whatever the
host publishes. This makes OpenSkyLight appear in network browsers as a named
service. It is cosmetic — the name resolves without it.

## Verify

From a phone or laptop on the same network:

```fish
ping openskylight.local
curl --fail http://openskylight.local:6123/health/ready
```

`{"status":"ready"}` means the name works. Then open
`http://openskylight.local:6123/admin/`.

Display enrollment links are built from whatever address the parent used to
reach `/admin/`, so once a parent administers the board by name, the enrollment
links they generate carry the name too. Nothing extra to configure.

## Limitations, stated plainly

- **It does not cross the remote-access tunnel.** mDNS is link-local multicast;
  it does not traverse WireGuard. A parent connected remotely under
  [`N07`](../tickets/N07-remote-access-adr.md) must use the server's tunnel
  address. Do not generate an enrollment link while connected remotely and
  expect a kiosk on the home LAN to be able to open it.
- **Android support is inconsistent.** Modern Android resolves `.local` in
  Chrome, but this varies by version and vendor. iOS, macOS, Windows 10+ and
  desktop Linux are reliable. The numeric address remains the fallback for any
  device that cannot resolve the name, which is why it is never removed.
- **One name per host.** Running two OpenSkyLight servers on one LAN means
  giving their hosts different hostnames.
- **The name is not a security boundary.** It resolves for anyone on the LAN,
  exactly as the IP address does. Display credentials and the household PIN are
  what protect the board.

## What this replaced

The superseded [ADR 0001](../adr/0001-headless-google-oauth.md) required a real
registered domain, verified ownership, trusted HTTPS and split-horizon DNS,
because Google's OAuth callback demanded it.
[ADR 0002](../adr/0002-provider-agnostic-calendar-access.md) removed that
requirement along with the Google layer, which is what makes a plain `.local`
name sufficient for the entire product.
