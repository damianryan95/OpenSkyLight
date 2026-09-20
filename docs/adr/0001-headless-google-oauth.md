# ADR 0001: Phone-authorized Google Calendar OAuth for the headless server

> **Superseded on 2026-09-20 by
> [ADR 0002](0002-provider-agnostic-calendar-access.md).** The Google-specific
> OAuth layer described below is being removed: its prerequisites (a Google
> Cloud project, a verified domain, trusted HTTPS, split-horizon DNS, a client
> secret, and a vault passphrase) are unreachable for a non-technical
> household, and they bind the product to a single calendar vendor. This
> document is retained for historical context only. Do not implement against
> it.

**Status:** Superseded by ADR 0002 (was: Accepted, spike complete)

**Date:** 2026-08-02
**Decision owner:** OpenSkyLight server

## Decision

Use Google's OAuth 2.0 **Web application** client and authorization-code flow
for Google Calendar connections.  The phone is the user agent, while the
headless OpenSkyLight server starts the flow, receives the callback, exchanges
the code, and refreshes tokens.  The server host never needs Electron, a local
browser, or an interactive desktop session.

Do **not** use the device authorization flow: Google's supported limited-input
device scopes do not include a Google Calendar scope, so it cannot authorize
the required Calendar read access.  Do not use the deprecated out-of-band
flow, an Electron `shell` callback, or a callback to `localhost`: a callback
to the phone's loopback address cannot be received by the server.

The OAuth client is configured by an authenticated parent in the phone portal.
The parent supplies the client ID, client secret, and a Google vault
passphrase; no Docker secret mount is required. The server generates the
refresh-token encryption key, encrypts it and the client configuration in
SQLite using a key derived from that passphrase, and never stores the
passphrase. After a restart, a parent must unlock the Google vault before sync
can resume. There is no plaintext compatibility or fallback mode.

## LAN topology and prerequisites

The operator provides one stable, registered hostname, for example
`https://osl.example.net`, which resolves from household phones to the LAN/VPN
address of the server (split-horizon DNS is appropriate).  TLS is terminated
by the server or its local reverse proxy with a certificate trusted by the
phone.  The authorization callback is:

```
https://osl.example.net/api/v1/google/callback
```

The hostname and exact callback URL are registered on the Google Cloud OAuth
client.  Google requires a web-server redirect URI to use HTTPS (other than
the localhost exception), forbids raw-IP hosts, requires a public-suffix TLD,
and requires an exact match.  The domain is registered as an Authorized Domain
and its ownership is verified.  The phone, rather than Google, follows the
redirect to the callback, so the callback can remain LAN/VPN reachable; the
server must **not** be port-forwarded to the public Internet.

This is an explicit deployment prerequisite, not an automatic fallback to
`http://192.168.x.y`, mDNS-only hostnames, self-signed TLS, or `localhost`.
Operators who cannot supply this hostname, trusted HTTPS, and secrets cannot
enable Google synchronization yet.

The server itself needs outbound HTTPS access to Google OAuth and Calendar
endpoints.  A phone needs Internet access for Google sign-in plus LAN/VPN
access to `osl.example.net`.  The normal household parent PIN session and
CSRF/origin checks protect the start, cancel, and disconnect endpoints.

## End-to-end flow

1. A parent signs into the phone administration UI over the HTTPS LAN/VPN URL
   and chooses **Connect Google account**.
2. `POST /api/v1/google/connect` requires the parent session, an approved
   Origin, and CSRF validation.  The server creates a single-use pending
   connection record with a 10-minute expiry.  It stores a hash of a random
   `state`, the parent-session identifier hash, requested scopes, and a
   per-attempt PKCE verifier.  The response directs the phone's normal system
   browser to Google's authorization endpoint with the exact redirect URI,
   `state`, `code_challenge` (`S256`), and `access_type=offline`.
3. The parent signs in to Google and grants `openid` and `email` so the server
   can identify which Google account was connected, plus
   `https://www.googleapis.com/auth/calendar.readonly`. The Calendar scope is
   necessary to discover calendars and cache their events; no Google write
   scope or profile access is requested.
4. Google redirects the same phone browser to the HTTPS callback.  The server
   validates the parent session, exact `state`, expiry, single-use status, and
   PKCE verifier before exchanging the authorization code from the server for
   tokens.  It never exposes the code, access token, refresh token, client
   secret, or verifier to browser JavaScript, URLs, logs, or event streams.
5. The exchange must return a refresh token.  The server encrypts it before
   inserting/updating the Google-account record, marks the attempt consumed,
   and redirects to the administration success page.  Calendar discovery and
   mapping happen in G02, not in this spike.

On consent denial, `error=access_denied`, expiry, a state/session mismatch, or
a token-exchange failure, consume the pending attempt, show a generic failure
to the parent, and offer a fresh **Retry** action.  A **Cancel** action deletes
the pending attempt and returns to settings; it never revokes an already
connected account.  Disconnect is a separate, parent-authorized action that
deletes the encrypted token and calls Google's revocation endpoint best-effort
(record and surface a revocation failure without retaining a usable token).

## Token refresh and failure handling

Store the refresh token, account ID, granted scopes, connected time, and last
refresh outcome.  Keep access tokens in process memory only; never persist
them.  Before a Calendar request, refresh when near expiry using the OAuth
token endpoint.  Atomically persist a replacement refresh token only when
Google returns one.  A refresh result with `invalid_grant` (or an equivalent
revocation/expiration condition) disables that account's sync, retains cached
events, marks reauthorization required, and does not retry indefinitely.

Transient network and 5xx failures use bounded exponential backoff.  They
retain the last successful cache and contribute to visible sync-health state.
All tokens and OAuth error responses are redacted before logging; diagnostics
may identify the account by non-secret local ID and the error class only.

## Secret and ciphertext storage contract

The parent portal accepts the Google Web-client ID/secret over the existing
authenticated HTTPS admin session. On first configuration, the server generates
a random 32-byte application key in an owner-readable file beside the SQLite
database and encrypts both configuration and every refresh token with
AES-256-GCM. A fresh 96-bit nonce, versioned envelope, and authenticated
associated data bind ciphertext to the household and account. It refuses to
decrypt an unknown envelope version and refuses to write anything but a valid
encrypted envelope.

Backups and restores must include both the database and its adjacent key file.
A database-only backup does not expose the Google secrets, but loss of the key
requires reconnecting the Google accounts. Anyone who obtains the complete
application-data volume can decrypt the secrets, so volume access and backups
must be protected as credentials.

## Google Cloud setup

1. Create/select the operator's Google Cloud project and enable Google
   Calendar API.
2. Configure the consent screen.  For an external production app using this
   Calendar read scope, provide the verified-domain homepage and privacy policy
   and complete the applicable OAuth verification before broad release.  For
   a testing-only project, explicitly add the household Google accounts as test
   users and accept the testing-token limitations.
3. Add and verify `example.net` as an Authorized Domain, then create a **Web
   application** OAuth client.  Register only the exact callback above; do not
   register wildcard, IP, HTTP, or arbitrary LAN host callbacks.
4. Open the authenticated parent portal at the public/split-horizon HTTPS base
   URL, save the downloaded client ID/secret and a long Google vault
   passphrase, then register the callback URI displayed by the portal.
5. From a parent phone, complete the connection flow, confirm the account is
   listed, restart the server, and confirm it can refresh without a browser.

## Evidence and sources

This decision is an architecture/documentation spike.  It deliberately does
not use a live account or store credentials in the repository.  The sequence
above is directly implementable and testable using a redacted operator-run
connection after the stated DNS, TLS, Cloud-project, and secret prerequisites
exist.

- [Google: web-server authorization and offline refresh tokens](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google: OAuth client redirect-URI and secret rules](https://support.google.com/cloud/answer/15549257)
- [Google: limited-input device flow and its allowed scopes](https://developers.google.com/identity/protocols/oauth2/limited-input-device)
- [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google: token storage and invalidation best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google: OAuth branding, authorized-domain, and verification requirements](https://support.google.com/cloud/answer/15549049)

## Consequences and follow-up

G02 must implement the pending-attempt store, callback route, PKCE/state
validation, authenticated token envelope, and tests for cancel/retry/error/
redaction paths. It must replace the legacy Electron `safeStorage`/`shell`
OAuth implementation rather than adapting it. Deployment documentation must
define the HTTPS split-horizon/VPN setup and the vault-unlock requirement.
