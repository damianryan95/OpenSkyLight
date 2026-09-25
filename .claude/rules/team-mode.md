# Agent Team Execution

Agent Teams are permanently available, but availability is not permission to use them by default.

## Team Gate

Create an Agent Team only when all are true:
1. At least two substantial workstreams exist.
2. They can make useful progress concurrently.
3. They need peer coordination or a shared evolving contract while working.
4. Coordination adds more value than independent subagents reporting to the Curator.
5. Ownership boundaries can be made clear enough to avoid destructive overlap.

Do not create a team for simple changes, sequential work, same-file editing, routine review, ordinary exploration, or parallel work that does not require peer communication.

## Automatic activation

When the Team Gate passes, the Curator must activate team mode itself before the first named teammate:

```bash
node .claude/hooks/team-control.mjs start "<objective>"
```

The user must never be asked to toggle environment variables or manually enable teams.

A PreToolUse guard rejects named teammate launches when this gate is inactive for the current Claude session.

## Team Lead

The Curator becomes Team Lead and owns:
- objective and acceptance criteria
- decomposition and task dependencies
- worker lifecycle and team size
- permissions and budgets
- integration
- final verification
- shutdown

Workers own execution inside their assigned boundary. They may investigate, challenge, propose, implement, and test. They may not redefine the objective, spawn workers, create nested teams, or declare the overall objective complete.

Delegation depth: **1**.

## Worker selection

Use an explicit specialist type for every teammate. Do not use generic `general-purpose` or `claude` workers.

For normal code-writing workstreams use `implementer`.
Use `investigator`, `debugger`, `architect`, `verifier`, or `security` only when their specialist process is actually required.

## Team size

- default: 2 workers
- normal maximum: 3
- exceptional maximum: 4

Increase team size only when independent work and elapsed-time benefit justify the additional tokens and coordination.

## Task contracts

Every teammate gets:
- agent type
- stable assignment/objective
- owned scope
- excluded scope
- inputs/dependencies
- expected outputs
- success criteria
- permissions
- stop conditions

Use the native Claude Code shared task list for live task state and dependencies. Do not duplicate that state in project files.

Use `.claude/team/contracts/` only for durable interface/behaviour contracts worth sharing across workers.

The task title/objective is the stable assignment. Do not continually rename it to display progress; current activity belongs to runtime telemetry.

## Communication

Peer messages should change another worker's execution. Prefer these event types:
- `FINDING`
- `CONTRACT_CHANGE`
- `BLOCKER`
- `HANDOFF`

Avoid status narration, long context copies, and unsolicited reviews.

## Concurrency and files

Prefer separate modules/files and explicit ownership. For concurrent writers, use worktree isolation or non-overlapping write scopes. Avoid multiple agents editing the same file.

## Replanning

Replan only when a core assumption is false, a shared contract changes materially, dependencies change, a workstream becomes unnecessary, workstreams collide, or the objective cannot be met with the current design.

## Collapse and shutdown

Collapse the team early when coordination no longer adds value, only one meaningful workstream remains, or a discovery invalidates outstanding work.

When finished:
1. wait for required outputs
2. integrate through the Curator
3. run deterministic checks
4. perform independent verification when warranted
5. gracefully shut down teammates
6. run `node .claude/hooks/team-control.mjs stop`

The Curator then continues in normal mode.
