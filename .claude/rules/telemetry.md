# Agent Runtime Telemetry Contract

The runtime and any visualiser must distinguish four concepts:

1. **Agent identity** — stable type/name for the run, e.g. `implementer`, `debugger`.
2. **Assignment** — stable objective/task given at spawn time.
3. **Activity** — mutable current action inferred from explicit task updates and tool/lifecycle events.
4. **Lifecycle** — queued, starting, working, blocked, waiting, completed, failed, cancelled.

Do not overwrite the assignment merely to display progress.

## Stable assignment

An assignment should retain:
- task id when available
- title
- objective
- owned scope
- agent type
- team id when applicable

## Live activity

Current activity should be updated from the best available observable signal, in this order:
1. explicit task/state update
2. native Claude task/session state
3. latest meaningful tool/lifecycle event
4. initial assignment as fallback

Examples of activity summaries:
- `Reading ticket CLI implementation`
- `Implementing createTicket guardrails`
- `Editing .claude/hooks/agentviz-ticket.mjs`
- `Running collector typecheck`
- `Waiting for package contract`

Do not expose or attempt to reconstruct hidden chain-of-thought. Telemetry is limited to observable actions, declared summaries, tool calls, state transitions, evidence, and concise rationale supplied intentionally by the agent/Curator.

## Event classes

In addition to team coordination events, a visualiser may normalise:
- `AGENT_START`
- `AGENT_ACTIVITY`
- `AGENT_STATE`
- `TOOL_CALL`
- `TOOL_RESULT`
- `FILE_READ`
- `FILE_CHANGE`
- `TEST`
- `BUILD`
- `AGENT_STOP`
- `AGENT_FAIL`
- `AGENT_CANCEL`

The assignment remains stable while `AGENT_ACTIVITY` and lifecycle state change throughout execution.
