# A02 - Implement household PIN sessions

Status: done  
Depends on: A01, S02

## Context

Read target architecture section 7/Parent administration.

## Deliverable

Implement first-run PIN setup, login, logout, expiry, slow salted hashing,
attempt throttling/backoff, HttpOnly SameSite sessions, CSRF/origin protection,
PIN change, and global session invalidation. No usernames or recovery email.

Likely files: `src/server/auth/`, auth routes, schema migration, tests.

## Acceptance

- PIN is never stored or logged in plaintext.
- Brute-force attempts are throttled.
- State-changing parent routes require session and CSRF/origin checks.
- PIN change invalidates every prior session.

Verify: auth unit/API tests including expiry and attack cases.
