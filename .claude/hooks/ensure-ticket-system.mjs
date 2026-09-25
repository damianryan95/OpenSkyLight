import fs from 'node:fs';
import path from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ticketDir = path.join(projectDir, 'docs', 'tickets');
const readme = path.join(ticketDir, 'README.md');

fs.mkdirSync(ticketDir, { recursive: true });

if (!fs.existsSync(readme)) {
  fs.writeFileSync(readme, `# Project Tickets\n\nThis directory is the durable work ledger for substantive Claude Code objectives.\n\n## Rules\n\n- The Curator creates or selects a ticket before starting substantive multi-step implementation.\n- Small lookups, tiny one-step edits, and conversational questions do not require a ticket.\n- One ticket represents one coherent objective. Split unrelated work.\n- Record acceptance criteria before implementation.\n- Record the chosen execution mode and delegation decision before the first material code change.\n- Update status as work moves through implementation, verification, blocked, and complete.\n- Ticket state is durable project state; runtime agent activity belongs in telemetry, not in the ticket title.\n\n## Suggested filename\n\n\`TNN-short-title.md\`\n\n## Required sections\n\n- Objective\n- Acceptance Criteria\n- Scope\n- Execution Decision\n- Status\n- Evidence / Verification\n- Follow-up / Risks\n`);
}
