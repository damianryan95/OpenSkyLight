# Agent-system evaluation

Do not assume an agent is valuable because it sounds specialised. Measure it.

For representative repository tasks, compare:
- direct Curator execution
- Curator + one specialist
- parallel independent subagents where relevant
- Agent Team where coordination is genuinely required

Track:
- objective success / acceptance pass rate
- regressions and defects found before completion
- rework cycles
- elapsed latency
- Curator-context growth or compaction pressure
- total tokens/cost where available
- number of agent invocations
- coordination messages
- cancelled/obsolete work
- false-positive findings

Run ablations: remove one specialist or team mode and repeat comparable tasks. Keep a component only when it produces net quality, context, or time value relative to its cost.
