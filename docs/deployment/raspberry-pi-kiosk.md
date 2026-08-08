# Raspberry Pi Chromium kiosk

This is the one supported host configuration for an OpenSkyLight wall display:

- Raspberry Pi 5 (64-bit);
- Raspberry Pi OS Desktop (64-bit), using an **X11** desktop session;
- the distribution's `chromium-browser` package;
- an XDG desktop autostart entry; and
- a Docker-hosted OpenSkyLight server on the same trusted LAN or VPN.

It runs the ordinary browser kiosk bundle. There is no Pi-specific UI, API, or
database process. Do not expose the server to the public Internet.

> Status: configuration is provided, but this repository has **not yet been
> validated on real Pi hardware**. Follow the checklist below and record the
> result before treating this setup as supported in production.

## Prerequisites

The server URL must return the browser kiosk application's `index.html` at `/`
and its API under `/api`. From another LAN machine, verify it before preparing
the Pi:

```fish
curl --fail http://192.168.1.25:3000/
curl --fail http://192.168.1.25:3000/health/ready
```

Replace the address with the fixed DHCP lease or LAN DNS name used by your
server. Current source builds can serve the kiosk bundle when `out/kiosk` is
present; a container image must include that bundle as well. If the first
command returns `404`, do not provision a Pi yet: the deployed server image is
not serving the kiosk assets.

Prepare the display registration from the parent administration site. A
registered display needs its own device credential; never put a credential in a
shell history, screenshot, commit, or shared config file. The present parent
UI intentionally does not expose a kiosk enrollment handoff, so a safe
one-time provisioning flow is a required follow-up before unattended use.

## Install and configure

Install Raspberry Pi OS Desktop 64-bit, enable automatic login for a dedicated
unprivileged `kiosk` user, and select an X11 session at the login screen. Do
not use this recipe on the Wayland session: `unclutter-xfixes` and `xset` are
X11 tools.

In a Fish terminal on the Pi, install the browser and pointer helper:

```fish
sudo apt update
sudo apt install --yes chromium-browser unclutter-xfixes
```

Copy the repository example files while logged in as the kiosk user:

```fish
mkdir -p ~/.config/autostart
sudo install -m 755 deployment/raspberry-pi/openskylight-kiosk /usr/local/bin/openskylight-kiosk
sudo install -m 600 deployment/raspberry-pi/openskylight-kiosk.env.example /etc/openskylight-kiosk.env
install -m 644 deployment/raspberry-pi/openskylight-kiosk.desktop ~/.config/autostart/openskylight-kiosk.desktop
sudoedit /etc/openskylight-kiosk.env
```

Set `OSL_KIOSK_URL` to the server's stable LAN URL. Log out and in, or reboot:

```fish
systemctl reboot
```

After the graphical session starts, Chromium launches fullscreen and restarts
two seconds after an unexpected browser exit. The kiosk client's reconnect UI
continues to render cached content and retries its server event stream after a
server restart or transient Wi-Fi interruption.

## Touch and pointer

Use the display's native touch input as its USB/HID device. Chromium's normal
tap and on-screen-keyboard behavior is used; this host configuration adds no
touch translation layer. `unclutter-xfixes` hides only an idle mouse pointer,
so touch remains available. Set `OSL_HIDE_POINTER=false` while diagnosing
touch or cursor issues.

The kiosk's protected layouts are tested at 2400 x 900, 1920 x 1080, and 1280
x 800. On an ultra-wide panel it uses a centered bounded content area; do not
apply browser zoom or compositor scaling as a substitute for its responsive
layout.

## Display power and updates are host responsibilities

OpenSkyLight does not send DPMS, HDMI, compositor, or package-management
commands to a Pi. Choose and document one host policy per display:

- `OSL_DPMS=on`: allow the desktop session's X11 DPMS/screensaver policy. Set
  your timeout with the desktop's power settings or `xset` after confirming the
  panel and touch controller wake reliably.
- `OSL_DPMS=off`: keep the panel awake continuously. This is the safer initial
  choice for panels that fail to wake on touch, at the cost of power use and
  panel wear.

Apply Raspberry Pi OS and Chromium updates during a household maintenance
window, then reboot and run the checklist. The operator owns automatic-update
policy, image backups, firmware changes, and recovery media. Keep the Pi on a
fixed DHCP lease or LAN DNS name; it must be able to resolve the server URL at
boot.

## Real-device validation checklist

Record the exact observations in the deployment runbook. Do not mark this
ticket complete from desktop or emulator results.

| Check | Record |
| --- | --- |
| Hardware | Pi model/RAM, display model, touch controller, storage type |
| Software | `cat /etc/os-release`, `chromium-browser --version`, X11 session/version |
| Boot | Reboot with keyboard/mouse disconnected; Chromium reaches Family view |
| Touch | Tap avatars, views, and a 48 px target; verify the on-screen keyboard where used |
| Layout | Photograph 2400 x 900 (or target panel), and test centered/responsive layout |
| Browser recovery | Stop Chromium, confirm the launcher restarts it within a few seconds |
| Server recovery | Restart the server; confirm reconnect/stale status then current data without browser reload |
| Wi-Fi recovery | Disconnect/reconnect Wi-Fi; confirm the same recoverable state and recovery |
| DPMS | Test sleep and wake with the chosen host policy; note the wake input required |
| Updates | Update Chromium/OS, reboot, and repeat boot plus touch checks |

## Known deployment blockers

The remaining completion blocker is real-device evidence: run and record the
checklist on the exact supported Pi/display hardware before changing O02 to
done. The runtime image ships both browser bundles; verify this with the
prerequisite `curl` commands before provisioning a device.
