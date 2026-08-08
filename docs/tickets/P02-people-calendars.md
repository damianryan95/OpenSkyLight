# P02 - Build people and calendar administration

Status: done  
Depends on: P01, S03, G02, G04

## Context

Read target architecture sections 5/Calendar mappings, 5/Exact child-name
inference, 6, and 8/Parent phone application.

## Deliverable

Add phone flows for household members/roles, Google connection, calendar
selection, and mapping each selected calendar to Family or one person. Explain
child-name inference and surface duplicate-name validation. Do not edit events.

Likely files: admin pages/hooks, people/calendar API routes and schemas.

## Acceptance

- Fresh household can add everyone and connect/select calendars from a phone.
- Mapping clearly distinguishes Family from a person.
- Role changes affect name inference as specified.
- Event links open Google Calendar where practical; no local event editor exists.

Verify: mocked Google admin E2E and API/service tests.
