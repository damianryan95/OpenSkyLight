#!/usr/bin/env python3
"""Create a minimal agent-team ledger from the V1 templates."""
from pathlib import Path
import re
import sys

if len(sys.argv) < 3:
    raise SystemExit('Usage: python scripts/init_team_run.py <team-id> "<objective>"')

team_id = sys.argv[1].strip()
objective = sys.argv[2].strip()
if not re.fullmatch(r'[A-Za-z0-9._-]+', team_id):
    raise SystemExit('team-id may contain only letters, numbers, dot, underscore and hyphen')
if not objective:
    raise SystemExit('objective must not be empty')

repo = Path(__file__).resolve().parents[1]
run = repo / '.claude' / 'team' / 'runs' / team_id
if run.exists() and any(run.iterdir()):
    raise SystemExit(f'Run already exists and is not empty: {run}')

(run / 'contracts').mkdir(parents=True, exist_ok=True)
(run / 'artifacts').mkdir(parents=True, exist_ok=True)
(run / 'events').mkdir(parents=True, exist_ok=True)

safe_objective = objective.replace('\\', '\\\\').replace('"', '\\"')
(run / 'objective.yaml').write_text(
    f'team_id: {team_id}\nobjective: "{safe_objective}"\nstatus: active\nsuccess: []\nconstraints: []\n',
    encoding='utf-8'
)
(run / 'tasks.yaml').write_text('tasks: {}\n', encoding='utf-8')
(run / 'dependencies.yaml').write_text('tasks: {}\n', encoding='utf-8')
(run / 'blockers.yaml').write_text('blockers: []\n', encoding='utf-8')
(run / 'decisions.yaml').write_text('decisions: []\n', encoding='utf-8')

print(run)
