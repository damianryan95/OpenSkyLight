# Phone-first, LAN-only platform

Status: proposed product direction, decomposed for implementation
Source: `docs/app_changes.md` (raw notes), synthesized 2026-09-20

## 1. Outcome

Every household setup and ongoing control action happens from a parent's
phone, against a single Raspberry Pi that stays 100% headless (no keyboard,
monitor, or SSH required for normal operation). All data stays on that
device or in storage the household explicitly owns — no OpenSkyLight-operated
cloud service, and no off-device storage happens without the parent choosing
it. This extends, rather than replaces, the existing headless-server
architecture (`docs/target-architecture.md`) and the LAN/VPN-only security
posture in `README.md`.

This roadmap only covers what was in the raw notes (`docs/app_changes.md`).
It does not re-open or duplicate the in-flight personalization work
(`docs/personalization-roadmap.md`, tickets `PE05`–`PE10`) or the blocked
original-roadmap tickets (`O02`, `O04`) — those continue on their own track;
see section 6 for how they interleave.

## 2. Product principles

This fork's lineage is `lowerygt` (original Electron app) → `bradis86`
(headless server refactor, ADR 0001, LAN-only stance) → this repository. The
containerized server design is inherited deliberately and kept. Several of the
decisions made alongside it are not, because they optimize for a developer
operator rather than the household this product serves.

1. **The non-technical user is the target operator.** If a step requires a
   cloud console, a verified domain, a client secret, or a terminal, it is a
   defect and not a prerequisite.
2. **The household owns its data and its infrastructure.** Any cloud service
   must be owned by the solution, not a third party — unless it is installable
   locally and free of licence fees.
3. **Vendor-agnostic by default.** Sync the calendar the user already has,
   whoever provides it. No single-vendor integration is allowed to become the
   only path.
4. **Phone-first, anywhere.** Management happens from the phone, at home or
   away, without surrendering the security posture that made LAN-only
   attractive in the first place.

## 3. Decisions made (2026-09-20)

The three items previously blocked as open questions have been decided by the
project owner and recorded as ADRs. They are now implementation tickets.

- **Remove the Google OAuth layer entirely** — do not limit the product to one
  vendor's calendar, and do not require an API integration a household cannot
  perform. Replaced by a phone-native connector plus generic CalDAV/ICS.
  See [ADR 0002](adr/0002-provider-agnostic-calendar-access.md); ADR 0001 is
  superseded. Tickets `N13`, `N14`, `N05`, `N06`.
- **Remote access is in scope, self-hosted only.** Cloudflare Tunnel and
  Tailscale's hosted plane are rejected as third-party-operated. Accepted:
  WireGuard on the Pi with QR-code peer enrolment; self-hosted Headscale or
  NetBird as the CGNAT fallback. The web surface is still never published —
  the trusted network is extended to the phone instead. See
  [ADR 0003](adr/0003-self-hosted-remote-access.md); ticket `N07`.
- **Two-way calendar sync is in scope**, and is no longer blocked on a Google
  write scope, because writes go through the phone's own calendar store or an
  authenticated CalDAV collection. Ticket `N06`.

## 3a. Target device and distribution (2026-09-22)

The product becomes **a polished self-hosted application running on a small
computer**, with **Portainer kept as a deployable option for the more technical
individual**. Portainer is the advanced path; the default does not yet exist,
which is what `N16` addresses. [ADR 0004](adr/0004-bootable-appliance-image.md)
settles the mechanism: a **prebuilt bootable image**, written to a USB stick or
SSD and configured from the phone.

The device is deliberately **open, and unlikely to be a Raspberry Pi**. An x86
mini PC is the probable shape. Two consequences worth holding onto:

- **Cross-building disappears.** Same architecture as CI and the development
  machines, so the arm64 emulation problems hit during deployment stop applying.
- **Headroom returns.** A Pi 3B+ cannot run the server and a browser together;
  the current Pi is a **test rig only**, with `home-server` hosting and the Pi
  running Chromium.

Ticket assumptions that this changes are noted in `O02` and `N16`. `N02`'s
Wi-Fi access-point pairing is written Pi-first and should not be rewritten
until the device is chosen — on a box with ethernet, first-boot pairing may not
need an access point at all.

### Known tradeoff to watch

Mobile platforms restrict background execution, so a phone-native-only sync
path goes stale whenever nobody opens the app. This is why ADR 0002 keeps a
CalDAV/ICS server-side source alongside it rather than relying on the phone
alone. If real-world use shows CalDAV is rarely configured, revisit whether
the board needs a freshness guarantee that does not depend on phone usage.

## 4. Priority order

Calendar independence is Phase 1, ahead of the onboarding wizard. A polished
wizard has little value while the feature it onboards still demands a Google
Cloud project and a verified domain — the OAuth layer is the single largest
barrier for the target user, and it gates the product's core feature.

1. **Phase 0 — Unblock and orient** (no architecture risk)
   - `N01` Removed-functionality audit (pure analysis, immediately actionable)
   - `O02` Raspberry Pi kiosk hardware validation *(already open, blocked on
     hardware access — critical path for everything Pi-specific below)*
   - `N03` Local network name for the server (independent UX win)

2. **Phase 1 — Calendar independence** *(the headline change)*
   - `N13` Retire the Google OAuth layer and de-Google the event schema
   - `N14` CalDAV and ICS calendar source
   - `N17` Parent app pairing and token authentication *(prerequisite)*
   - `N05` Phone-native calendar connector *(Android; iOS is `N19`)*

3. **Phase 2 — Phone-first onboarding**
   - `N02` First-boot network pairing *(written Pi-first; settle against the
     chosen device — see section 3a)*
   - `N18` Screen-displayed QR enrolment and household claim *(ADR 0006; the
     ceremony `N04` is entered through)*
   - `N04` Phone-first setup wizard
   - `O04` Release hardening *(already open, blocked on `O02` evidence)*

4. **Phase 3 — Anywhere access and two-way sync**
   - `N07` Self-hosted remote access via WireGuard
   - `N06` Bidirectional calendar sync
   - `N15` On-screen calendar editing, once `N06` provides the write path

5. **Phase 4 — Backup and resilience**
   - `N08` Local USB backup target
   - `N09` Personal cloud backup target

6. **Phase 5 — "Sellable product" hardening** *(explicitly deferred in the
   source notes: "Later phases when project considered sellable")*
   - `N10` SD card photo storage (never backed up)
   - `N11` Device access hardening (developer-only access)
   - `N12` Power management (software + optional physical control)

7. **Phase 6 — Shipping it** *(deliberately last, 2026-09-22)*
   - `N16` Bootable appliance image, per
     [ADR 0004](adr/0004-bootable-appliance-image.md)

   The mechanism is decided; the timing is not now. An install image is built
   around a specific application on specific hardware, and neither is settled
   — the app is still gaining features and the device is still open. Building
   it earlier means building it twice. It happens once the owner is satisfied
   with both.

   Until then Portainer and Compose remain the install path, which is
   acceptable because the only current user is the person who wrote it.

Running in parallel throughout, unaffected by this roadmap:
- `PE05`, `PE06`, `PE07` (celebration media/admin/runtime) — in progress
- `PE08`, `PE09`, `PE10` (starter packs, theme composer, hardening) — planned

## 5. Dependency graph

```text
N01 (standalone)

N13 --> N14 --+
              +--> N06 --> N15
N13 --> N05 --+
N17 --> N05 --> N19 (blocked: needs a Mac)

N17 --> N18 --> N04

O02 --> N02 --> N04 <-- N03
              |
O02 --> O04 --+

N03 + N04 --> N07 --> N11

O03 --> N08 --> N09 --> N10

O02 --> N12
```

## 6. Ticket summary

| Ticket | Title | Status | Depends on |
| --- | --- | --- | --- |
| N01 | Removed-functionality audit | done | — |
| N13 | Retire the Google OAuth layer | done | — |
| N14 | CalDAV and ICS calendar source | done | N13 |
| N17 | Parent app pairing and token authentication | done | — |
| N18 | Screen-displayed QR enrolment and household claim | planned | N17 (ADR 0006 decided) |
| N05 | Phone-native calendar connector (Android) | in progress | N13, N17 (ADR 0005 decided) |
| N19 | iOS app platform and verification | blocked | N05; needs a Mac |
| N06 | Bidirectional calendar sync | planned | N05, N14 |
| N15 | On-screen calendar editing | planned | N06 |
| N16 | Install experience for a non-technical household | planned | — (ADR 0004 decided) |
| N02 | Pi first-boot Wi-Fi AP pairing | planned | O02 |
| N03 | Local network name for the server | planned | S06, O03 |
| N04 | Phone-first setup wizard | planned | N02, N03, P01, N18 |
| N07 | Self-hosted remote access via WireGuard | planned | N03, N04 |
| N08 | Local USB backup target | planned | O03 |
| N09 | Personal cloud backup target | planned | N08 |
| N10 | SD card photo storage (deferred) | planned | N08, N09 |
| N11 | Device access hardening (deferred) | planned | N07 |
| N12 | Power management (deferred) | planned | O02 |

Full ticket text lives alongside the rest of the backlog in `docs/tickets/`,
using the same format and agent handoff contract as
`docs/tickets/README.md`.

## 7. How this interacts with the existing open tickets

- **`G01`–`G05`** (Google OAuth spike, discovery, pull cache, event feeds,
  sync health) are superseded by ADR 0002. They stay marked done as a record
  of what was built; `N13` removes the code they produced. Do not treat them
  as current architecture.
- **`C03`** (removed two-way event editing) is partially reversed by `N06`,
  on a different technical basis — no Google write scope is involved.
- **`O02` (blocked) and `O04` (blocked)** remain on the critical path for
  every Pi-specific item — `N02`, `N04`, and `N12` all need the real-hardware
  evidence `O02` is waiting on. Phase 1 deliberately does not depend on it, so
  calendar independence can proceed while Pi hardware is unavailable.
- **`PE05`–`PE10`** (celebration media/admin/runtime, starter packs, composer,
  hardening) are independent of this roadmap and continue on their own track.

## 8. Non-goals for this roadmap

- Retaining any Google-specific code path behind a flag. ADR 0002 removes the
  layer rather than deprecating it.
- Any third-party-operated cloud service — Cloudflare Tunnel and Tailscale's
  hosted coordination plane are rejected by ADR 0003. Every storage, sync, and
  access target here is local, self-hosted, or an account the household
  already owns.
- Bespoke per-vendor calendar integrations. OS-native APIs and open standards
  (CalDAV, ICS) only.
- Re-opening C01 (camera) or C02 (BirdNET) — those stay removed unless `N01`'s
  audit leads to a separate, explicit decision to restore them.
- Giving the kiosk write capability. `K03`'s read-only display guarantees hold
  through `N06`.
