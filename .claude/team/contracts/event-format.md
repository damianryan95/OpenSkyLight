# Agent and Team Events

Use peer messages only when the information changes another worker's execution.

## Team coordination events

### FINDING
A discovery another workstream needs.

### CONTRACT_CHANGE
A shared API/schema/behaviour contract changed. State what changed, who is affected, and the durable contract artifact if one exists.

### BLOCKER
Work cannot proceed without a dependency, decision, permission, or missing information.

### HANDOFF
An owned output is complete and downstream work can proceed. Point to code, task, test evidence, or artifact rather than copying large content.

## Runtime/visualisation events

These are telemetry events rather than peer conversation:

- `AGENT_START` — establishes identity and stable assignment.
- `AGENT_ACTIVITY` — updates the current observable action without replacing the assignment.
- `AGENT_STATE` — lifecycle transition such as working, blocked, waiting, completed, failed, cancelled.
- `TOOL_CALL` / `TOOL_RESULT` — current tool execution and result summary.
- `FILE_READ` / `FILE_CHANGE` — observable file interaction.
- `TEST` / `BUILD` — deterministic verification activity.
- `AGENT_STOP` / `AGENT_FAIL` / `AGENT_CANCEL` — terminal lifecycle events.

Never use telemetry to infer or expose hidden chain-of-thought.
