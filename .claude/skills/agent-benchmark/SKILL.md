---
description: Benchmark whether this repository's agentic coding architecture provides net value compared with direct Curator execution.
disable-model-invocation: true
---

# Agent Architecture Benchmark

Run controlled comparisons rather than assuming an agent is useful.

For each benchmark task, execute comparable variants:

A. Curator only
B. Curator + candidate specialist
C. Curator + parallel specialists if relevant
D. Agent team only when the task genuinely requires coordination

Record:
- objective completion / acceptance pass rate
- regressions or defects
- primary-session context consumed
- total model tokens/cost if available
- wall-clock latency
- agent count
- tool calls
- retries/rework cycles
- human interventions
- useful findings accepted
- false positives / duplicated work

Use the same repository revision and objective for each variant where practical.

An agent earns a permanent place only if repeated evidence shows material value in quality, primary-context preservation, elapsed time, or specialist capability after accounting for total compute and coordination cost.

Do not optimise only for main-context savings: a subagent can preserve the Curator window while increasing total cost substantially.

Use `.claude/evaluation/benchmark-case.yaml` and `result.json.example` as recording templates.
