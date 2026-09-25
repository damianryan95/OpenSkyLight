# Ticket Discipline

`docs/tickets/` is the durable work ledger for substantive objectives in this repo. It is a real
product feature of AgentViz (parsed by `packages/shared/src/tickets.ts`, rendered in the UI's Progress
tab) as well as the Curator's own process record — one ticket format serves both, so never write a
different one.

Read and write it only through `node .claude/hooks/agentviz-ticket.mjs` (add `--as ai` when you, the
Curator, are the actor). Never hand-edit a ticket's frontmatter, and never invent an alternate template —
if a scaffold or generic instruction ever suggests a different ticket shape for this repo, that scaffold
is wrong for this repo; follow this file instead.

## Automatic setup

`docs/tickets/` and its `README.md` already exist in this repo (built under ticket T05); there is no
session-start hook that creates them, and none is needed here.

## When a ticket is required

Create or select a ticket before implementation when an objective is substantive enough to involve any
of:
- multiple implementation steps
- more than one meaningful file/module
- investigation followed by a code change
- delegated work or agent teams
- a user-visible feature, defect fix, or architectural change
- work likely to continue across turns or context compaction

Do not create tickets for trivial lookups, one-line edits, or purely conversational questions.

## Workflow

1. If the objective names a ticket ID, or one clearly matches, `ticket start <ID>` before any edit.
   Otherwise `ticket list --status ready,in\ progress` first.
2. Read only what the ticket points at. No unrelated cleanup; no starting dependent or follow-up
   tickets.
3. Before `ticket new`: `ticket list --grep <title words>`. Create only when the work cannot be
   attributed to an existing ticket, and say why in `--why`. `--checked` (the tickets you ruled out) is
   mandatory for the AI actor. A new AI ticket is created `planned`; a user must move it to `ready`
   before it is started in the same session (or record the reason it's safe to start immediately, as
   with prior tickets in this session).
4. **Before the first material code change**, record the execution mode and delegation decision with
   `ticket execution <ID> --mode <direct|tool|skill|subagent|parallel-subagents|team>
   --delegation <none|investigator|implementer|debugger|architect|verifier|security|mixed>
   --reason "<one sentence tied to .claude/rules/delegation.md>"`. This sets structured frontmatter
   (`execution_mode`/`execution_delegation`/`execution_reason`) that AgentViz's policy-compliance check
   compares against observed runtime behaviour, in addition to appending the same
   `Execution decision: mode=...; delegation=...; reason=...` line to `## Discoveries` that `ticket note`
   would. If the objective bundles multiple independent workstreams, record a decision per workstream
   (each `ticket execution` call overwrites the ticket's single declared decision, so for a bundle either
   pick the dominant workstream's decision for the structured fields and note the rest as free text via
   `ticket note`, or split the ticket per `.claude/rules/delegation.md`). A ticket with no declared
   decision shows a policy status of `unknown`, never a deviation — recording one is how a ticket becomes
   checkable, not a requirement for every ticket.
5. Log other discoveries with `ticket note` as they happen, not saved up for the end.
6. Propose splits with `ticket split` when one ticket turns out to cover independent workstreams with
   separate acceptance criteria, and report the split to the user.
7. `ticket status <ID> done --evidence "..."` only after applicable deterministic checks pass; the CLI
   refuses to close a ticket whose `## Verify` section is empty. An acceptance criterion that needs a
   product decision or hardware you don't have → `ticket status <ID> blocked --reason "..."` and stop.
8. Branch `ticket/<id>-<slug>` for the work; push per phase, not per ticket.
9. After `status done`, run `node .claude/hooks/agentviz-ticket.mjs index` to refresh
   `docs/tickets/README.md`'s status table.

## Ticket ownership

Only the Curator runs `start`, `new`, `split`, and `status`. Workers may reference a ticket ID and
`ticket note` evidence against it, but must not change its authoritative status.

## Anatomy of a ticket

Frontmatter: `id`, `title`, `status` (`planned | ready | in progress | blocked | done`), `depends_on`,
`related`, `created_by` (`user | ai`), `created_at`, `created_in` (session id, AI-created only), `why`,
`checked`, `execution_mode` / `execution_delegation` / `execution_reason` (the declared decision, set via
`ticket execution`; absent = policy status `unknown`), `split_from`, and once closed `closed_by` /
`closed_evidence`.

`ticket new`/`ticket split` scaffold five body sections: `Context`, `Deliverable`, `Likely files`,
`Acceptance`, `Verify`. Fill them in before implementing; `ticket note` appends dated bullets to a
`Discoveries` section instead of these (that's where the execution-decision note above lands too).
