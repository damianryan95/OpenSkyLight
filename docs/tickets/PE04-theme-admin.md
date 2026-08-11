# PE04 - Add parent theme assignment

Status: done
Depends on: PE02, PE03

## Context

Read personalization roadmap sections 2–3 and 5. Read target architecture
section 8/Parent phone application.

## Deliverable

Add a phone-first **Personalize** action for each person and a theme gallery that
uses the production theme registry. Show compact light/dark previews, theme
descriptions, selection state, and a neutral default. Save through the parent
API; do not move person themes into display settings.

Preview rendering must be isolated from the admin document root so trying a
theme cannot restyle the entire parent application.

Likely files: people administration page/components, theme preview component,
admin API hooks, E2E/API tests.

## Acceptance

- A parent can inspect, assign, change, and clear a person's theme from a phone.
- Preview represents both light and dark variants without changing admin chrome.
- Save errors retain the user's selection and give an actionable inline message.
- Theme assignment is clearly separate from device color mode and permissions.
- Deleted/unknown assignments display the neutral fallback and can be repaired.
- All controls meet phone sizing, focus, label, and screen-reader requirements.

Verify: phone viewport E2E, parent authorization/API tests, keyboard and
screen-reader-name assertions.
