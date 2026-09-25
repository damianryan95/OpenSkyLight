# Delegation and Routing

Use the least expensive execution mode that can solve the task reliably.

## Gate

Before spawning an agent, ask:
1. Can direct Curator work solve this quickly?
2. Can deterministic search/test/static analysis/script solve it?
3. Will isolated context materially protect the Curator context?
4. Is specialist reasoning genuinely required?
5. Can the work proceed independently enough to justify coordination cost?
6. Will the returned result be materially smaller than the context needed to discover it?

If the answer does not justify delegation, do the work directly.

## Routing

Route deliberately. Do not use generic catch-all agents.

- **Simple implementation / small edit** → Curator
- **Quick read-only lookup / file discovery** → built-in `Explore` when it is cheaper than Curator search
- **Substantial repository exploration / context compression** → `investigator`
- **Bounded code implementation** → `implementer`
- **Uncertain failure mechanism / root cause** → `debugger`
- **Consequential cross-boundary design** → `architect`
- **Independent objective validation** → `verifier`
- **Material security boundary / adversarial analysis** → `security`

The built-in `general-purpose` and `claude` catch-all agents are intentionally denied. If no specialist fits, the Curator should work directly unless a bounded Implementer workstream can be defined.

## Parallel subagents vs team

Use parallel subagents when independent workers can simply return results to the Curator.

Use an agent team only when workers must exchange discoveries, contracts, blockers, or handoffs during execution.

For parallel code-writing tasks, use `implementer` workers with non-overlapping ownership and worktree isolation where appropriate.

Never spawn agents merely to mirror human job titles.

## Pre-implementation checkpoint

For every substantive ticketed objective, record the chosen execution mode in the ticket before the first material code change. If the objective contains multiple independent asks, evaluate each workstream separately rather than defaulting the entire bundle to direct Curator work.
