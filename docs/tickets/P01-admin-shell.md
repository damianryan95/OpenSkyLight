# P01 - Build the phone admin shell and PIN login

Status: done  
Depends on: A01, A02

## Context

Read target architecture sections 7/Parent administration and 8/Parent phone
application.

## Deliverable

Create the responsive parent web shell with first-run PIN setup, login, logout,
session expiry handling, navigation, form primitives, validation errors, and a
shared visual language suited to phones. Do not implement resource editors yet.

Likely files: companion/admin app, API client, shared styles/components.

## Acceptance

- Setup/login/logout works on a narrow phone viewport.
- Session expiry returns safely to login without losing server integrity.
- No username/email is requested.
- The wall layout is not merely shrunk onto the phone.

Verify: auth Playwright journey at representative phone sizes.
