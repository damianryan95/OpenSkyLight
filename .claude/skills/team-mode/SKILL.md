---
name: team-mode
description: Activate and run a disciplined Curator-led Agent Team only when multiple substantial parallel workstreams require coordination with each other.
---

# Team Mode

Use only after the Team Gate in `.claude/rules/team-mode.md` passes.

1. Activate the session gate:
   `node .claude/hooks/team-control.mjs start "<objective>"`
2. Decompose work into dependency-aware tasks using Claude Code's native shared task list.
3. Spawn the minimum useful number of named teammates, reusing `.claude/agents/` definitions where appropriate.
4. Give each teammate a bounded task contract and clear file/module ownership.
5. Allow peer messages only for findings, contract changes, blockers and handoffs that alter execution.
6. Monitor exceptions and dependencies rather than narrating progress.
7. Cancel obsolete work promptly.
8. Integrate through the Curator.
9. Run deterministic verification, then independent verification/security only when warranted.
10. Gracefully shut down teammates.
11. Close the gate: `node .claude/hooks/team-control.mjs stop`.

Never ask the user to enable teams manually.
