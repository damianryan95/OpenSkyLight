# Team runtime state

`templates/` defines the V1 shared-ledger shapes.

`runs/` contains ephemeral state for active/finished agent teams and is ignored by Git by default. Preserve a run selectively only when its decisions/evidence are valuable enough to become normal project documentation.

Create a run with:

```bash
python scripts/init_team_run.py <team-id> "<objective>"
```

The ledger is intentionally small. Do not mirror every message or tool call into it.
