# IPC capability inventory and HTTP boundary proposal

Status: verified against `src/shared/ipc/contract.ts` on 2026-08-02  
Scope: the 70 invoke channels in `IpcContract`; the six one-way Electron push
channels are recorded separately below.

This inventory is a migration boundary, not an authorization policy for the
current Electron app.  The five dispositions are mutually exclusive:

- **display-read**: a display session may make the future read request.
- **display-chore-write**: the sole display mutation; the server must restrict
  it to completion or undo for its current household date.
- **parent-write**: parent-session administration (including administrative
  reads that must not be exposed to a display).
- **obsolete-event-write**: remove; Google Calendar becomes the exclusive event
  editor and OpenSkyLight only pulls its cache.
- **obsolete-feature**: remove rather than carry into the LAN server/client
  architecture.

## Invoke-channel disposition

| Channel | Disposition | Future `/api/v1` boundary / migration note |
| --- | --- | --- |
| `app:getInfo` | display-read | `GET /system/info`; expose server version and household zone, not Electron platform. |
| `app:installUpdate` | obsolete-feature | Desktop updater is retired with Electron; container release operations are not a client API. |
| `settings:getAll` | parent-write | `GET /household/settings` and `GET /displays/{id}/settings`; split central household and registered-display settings. |
| `settings:set` | parent-write | `PATCH /household/settings` or `PATCH /displays/{id}/settings`; parent-only. |
| `people:list` | display-read | `GET /people`; display needs names/avatars for viewing context. |
| `people:create` | parent-write | `POST /people`. |
| `people:update` | parent-write | `PATCH /people/{id}`. |
| `people:delete` | parent-write | `DELETE /people/{id}`. |
| `calendars:list` | display-read | `GET /calendar-mappings` or a display calendar feed; do not reveal account secrets. |
| `calendars:create` | parent-write | Replace local-calendar creation with parent-managed Google calendar mapping. |
| `calendars:update` | parent-write | `PATCH /calendar-mappings/{id}`. |
| `calendars:delete` | parent-write | `DELETE /calendar-mappings/{id}`. |
| `events:getOccurrences` | display-read | `GET /events?start=&end=&personId=`; events are cached Google reads with server-derived audiences. |
| `events:get` | display-read | `GET /events/{id}`; read-only event detail. |
| `google:getStatus` | parent-write | `GET /google/status`; parent diagnostics/account administration. |
| `google:setCredentials` | parent-write | Retired with Electron; authenticated parent portal now stores the OAuth configuration in its encrypted Google vault. |
| `google:connect` | parent-write | `POST /google/accounts/connect`; begin the selected headless OAuth flow. |
| `google:disconnect` | parent-write | `DELETE /google/accounts/{id}`. |
| `google:listRemoteCalendars` | parent-write | `GET /google/accounts/{id}/calendars`; parent discovery only. |
| `google:setCalendarSelected` | parent-write | `PUT /calendar-mappings/{googleCalendarId}`; include the Family/person mapping. |
| `ics:add` | obsolete-event-write | Remove local ICS event source/import; Google Calendar is the exclusive source. |
| `chores:list` | display-read | `GET /chores`; display receives definitions scoped for its viewing context. |
| `chores:create` | parent-write | `POST /chores`. |
| `chores:update` | parent-write | `PATCH /chores/{id}`. |
| `chores:delete` | parent-write | `DELETE /chores/{id}`. |
| `chores:getDay` | display-read | `GET /chore-days/{date}`; server applies the selected viewing context. |
| `chores:complete` | display-chore-write | `POST /chore-days/today/completions`; ignore a client date and enforce server household date. |
| `chores:uncomplete` | display-chore-write | `DELETE /chore-days/today/completions/{choreId}`; same server-date enforcement. |
| `stars:balances` | display-read | `GET /star-balances`; scope to selected person when applicable. |
| `lists:getAll` | display-read | `GET /lists`; shared content is read-only on a display. |
| `lists:create` | parent-write | `POST /lists`. |
| `lists:update` | parent-write | `PATCH /lists/{id}`. |
| `lists:delete` | parent-write | `DELETE /lists/{id}`. |
| `listItems:add` | parent-write | `POST /lists/{id}/items`. |
| `listItems:toggle` | parent-write | `PATCH /list-items/{id}`; checkbox changes are not display mutations. |
| `listItems:delete` | parent-write | `DELETE /list-items/{id}`. |
| `listItems:clearChecked` | parent-write | `POST /lists/{id}/clear-checked` (or a bulk delete command). |
| `meals:getRange` | display-read | `GET /meals?start=&end=`. |
| `meals:set` | parent-write | `PUT /meals/{date}/{slot}`. |
| `rewards:list` | display-read | `GET /rewards`; display may view rewards. |
| `rewards:create` | parent-write | `POST /rewards`. |
| `rewards:update` | parent-write | `PATCH /rewards/{id}`. |
| `rewards:delete` | parent-write | `DELETE /rewards/{id}`. |
| `rewards:redeem` | parent-write | `POST /rewards/{id}/redemptions`; redemption is explicitly parent-side. |
| `rewards:redemptions` | parent-write | `GET /reward-redemptions`. |
| `rewards:grant` | parent-write | `POST /reward-redemptions/{id}/grant`. |
| `rss:getFeed` | display-read | `GET /rss-feeds/{id}` (or server-composed display feed); read-only. |
| `weather:get` | display-read | `GET /weather`; read-only display widget data. |
| `weather:searchCity` | display-read | `GET /weather/cities?query=`; lookup is non-mutating exploration; any saved location remains parent-only settings. |
| `screensaver:pickFolder` | parent-write | Replace Electron folder picker with parent-managed registered-display photo/source settings. |
| `screensaver:listPhotos` | display-read | `GET /displays/{id}/screensaver/photos`; do not expose host filesystem paths. |
| `kiosk:previewScreensaver` | parent-write | Becomes a client-local preview after parent updates display settings; no server mutation command required. |
| `companion:getStatus` | obsolete-feature | Retire the paired companion RPC server; phone uses authenticated `/api/v1`. |
| `companion:issueToken` | obsolete-feature | Retire pairing token flow in favour of PIN parent sessions and display registration. |
| `companion:unpairAll` | obsolete-feature | Retire companion pairings; registered displays have their own revocable credentials. |
| `auth:getStatus` | parent-write | `GET /auth/session` for the phone admin shell; a display never receives PIN state. |
| `auth:verifyPin` | parent-write | `POST /auth/session`; returns/sets an HttpOnly parent session, not an `unlocked` boolean. |
| `auth:setPin` | parent-write | `PUT /household/pin`; invalidate all parent sessions. |
| `auth:lock` | parent-write | `DELETE /auth/session` (sign out). |
| `sync:now` | parent-write | `POST /google/sync`; a parent diagnostic command. |
| `sync:getStatus` | display-read | `GET /sync/status`; display receives only safe health/staleness information. |

## One-way Electron push channels

These do not belong to `IpcContract`, so the mechanical check below deliberately
does not count them among its 70 contract operations.  They still have exactly
one disposition for the migration.

| Channel | Disposition | Future transport |
| --- | --- | --- |
| `push:dataChanged` | display-read | SSE invalidation event, expanded for every affected resource domain. |
| `push:syncStatus` | display-read | SSE sync-health/staleness event. |
| `push:kioskIdle` | display-read | Browser-local kiosk state; no server event needed unless device diagnostics later require it. |
| `push:sleepState` | display-read | Browser/device-local state; no server event needed for the initial deployment. |
| `push:updateReady` | obsolete-feature | Retire with Electron desktop updater. |

## `/api/v1` resource and DTO ownership

The HTTP API owns wire DTOs and Zod schemas in a transport-neutral shared API
package. Domain services own internal entities and must not import HTTP or
Electron types. Browser clients own only view models and transient viewing
context (the selected avatar); they do not own authoritative DTO definitions.

| Resource group | API ownership and client access |
| --- | --- |
| `system`, `auth`, `displays` | Server/API owns health, parent session, PIN, display registration, and device settings DTOs. Parent administers them; a display receives only its credential-scoped configuration. |
| `people`, `calendar-mappings`, `events` | Server owns people, Google-account/mapping admin DTOs, cached event DTOs, and derived audiences. Displays read people and event feeds; parent owns mapping changes. |
| `chores`, `chore-days`, `star-balances`, `rewards` | Server owns definition, completion, ledger, balance, reward, and redemption DTOs. Displays read feeds and may issue only the two `today` completion commands. |
| `lists`, `list-items`, `meals` | Server owns household content DTOs. Displays read; parent owns all commands. |
| `weather`, `rss-feeds`, `sync` | Server owns external-data and sync-health DTOs. Displays read safe cached data/health; parent owns refresh and configuration. |

### DTOs requiring semantic changes before reuse

- `AppSettings` must split into household settings and per-display settings.
  Host paths, Electron window options, and direct filesystem-photo fields must
  not cross the browser API.
- `PersonDto` needs an explicit household role (`child` is meaningful to event
  inference) and stable avatar data. The selected person is not a credential.
- `CalendarDto` must become a Google calendar mapping DTO with nullable
  `audiencePersonId`; local/ICS provider creation is removed. Google account
  credentials and refresh tokens are never DTO fields.
- `EventDto` and `OccurrenceDto` must lose create/update/delete inputs and
  manual assignment semantics. Cached events need a server-derived effective
  person-ID audience, Google identity/timestamps as needed, and a read-only
  source indicator.
- `ChoreDto` / `DayChoreDto` completion commands must not accept an arbitrary
  display date. Use server-owned household date and idempotent completion DTOs;
  parent correction remains a separate capability. Star ledger updates stay in
  the same server transaction.
- `StarBalanceDto`, `RewardDto`, and `RedemptionDto` need person scoping and
  explicit parent-only redemption/grant semantics; a display cannot redeem.
- `ListDto`, `ListItemDto`, and `MealSlotDto` remain reusable as reads but all
  mutation inputs become parent-only commands.
- Google status, sync status, and app info must be split into safe display
  health DTOs and richer parent diagnostics. Replace Electron `platform`,
  `unlocked`, companion pairing, and updater fields with server/session/device
  concepts.
- Weather city lookup remains a read DTO, while a persisted location belongs to
  parent-managed settings; photo URLs must be browser-safe URLs rather than
  `osl-photo://` or filesystem paths.

## Mechanical verification

Run:

```sh
node scripts/verify-ipc-capability-inventory.mjs
```

The verifier extracts every invoke key from `IpcContract`, extracts inventory
rows from this document, and fails for a missing key, duplicate key, extra key,
or disposition outside the five values above.
