/**
 * node --test .claude/hooks/agentviz-ticket.test.mjs
 *
 * Every case runs the real CLI as a child process against a temp tickets dir
 * (`AGENTVIZ_TICKETS_DIR`) with `AGENTVIZ_DISABLED=1`, so no envelope leaves the
 * process — except the one transport test, which points the collector at a dead
 * port and asserts the spooled envelope. Exit codes are asserted, not just text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./agentviz-ticket.mjs', import.meta.url));

function ctx(session = 'sess_test') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentviz-ticket-'));
  const tickets = path.join(root, 'docs', 'tickets');
  fs.mkdirSync(tickets, { recursive: true });
  return { root, tickets, home: path.join(root, 'home'), session };
}

function run(c, args, extraEnv = {}) {
  const env = {
    ...process.env,
    AGENTVIZ_DISABLED: '1',
    AGENTVIZ_TICKETS_DIR: c.tickets,
    AGENTVIZ_HOME: c.home,
  };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_AGENT_ID;
  if (c.session) env.CLAUDE_CODE_SESSION_ID = c.session;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', cwd: c.root });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

function seed(c, o) {
  const {
    id, title, status = 'ready', depends = [], created_by = 'user', created_in,
    why, verify = '- npm test', context = 'seeded',
  } = o;
  const lines = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `status: ${status}`,
    `depends_on: [${depends.join(', ')}]`,
    'related: []',
    `created_by: ${created_by}`,
    'created_at: 2026-09-24',
  ];
  if (created_in) lines.push(`created_in: ${created_in}`);
  if (why) lines.push(`why: ${why}`);
  lines.push('checked: []', '---');
  const body = `\n## Context\n\n${context}\n\n## Acceptance\n\n1. it works\n\n## Verify\n\n${verify}\n`;
  const file = path.join(c.tickets, `${id}-${slug(title)}.md`);
  fs.writeFileSync(file, lines.join('\n') + '\n' + body);
  return file;
}

function readTicketFile(c, idPrefix) {
  const name = fs.readdirSync(c.tickets).find((f) => f.startsWith(`${idPrefix}-`));
  assert.ok(name, `no file for ${idPrefix} in ${fs.readdirSync(c.tickets).join(', ')}`);
  return fs.readFileSync(path.join(c.tickets, name), 'utf8');
}

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

test('new numbers sequentially across every series', () => {
  const c = ctx(null); // user actor
  seed(c, { id: 'T01', title: 'Ticket schema' });
  seed(c, { id: 'PE18', title: 'Pairing flow' });
  const r = run(c, ['new', '--title', 'Parent app pairing credential', '--series', 'N', '--why', 'not covered elsewhere']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split('\n')[0].trim(), 'N19');
  assert.match(readTicketFile(c, 'N19'), /^---\nid: N19\n/);
});

test('list and show read the seeded tickets', () => {
  const c = ctx(null);
  seed(c, { id: 'T01', title: 'Ticket schema' });
  seed(c, { id: 'T02', title: 'Ticket CLI', status: 'planned' });
  const list = run(c, ['list']);
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /T01/);
  assert.match(list.out, /T02/);
  const only = run(c, ['list', '--status', 'planned']);
  assert.equal(only.code, 0, only.err);
  assert.doesNotMatch(only.out, /T01/);
  const show = run(c, ['show', 't01']);
  assert.equal(show.code, 0, show.err);
  assert.match(show.out, /## Verify/);
  assert.equal(run(c, ['show', 'T99']).code, 1);
});

test('list --grep ranks by word overlap over title and why', () => {
  const c = ctx(null);
  seed(c, { id: 'T01', title: 'Collector ticket API', why: 'routes for tickets' });
  seed(c, { id: 'T02', title: 'Unrelated hardware bring-up' });
  const r = run(c, ['list', '--grep', 'collector ticket routes']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /T01/);
  assert.doesNotMatch(r.out, /T02/);
});

// ---------------------------------------------------------------------------
// new — refusal paths
// ---------------------------------------------------------------------------

test('new is refused for an AI actor without --why', () => {
  const c = ctx();
  const r = run(c, ['new', '--title', 'Some fresh work', '--series', 'T', '--checked', 'none']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--why/);
  assert.equal(fs.readdirSync(c.tickets).length, 0);
});

test('new is refused for an AI actor without --checked', () => {
  const c = ctx();
  const r = run(c, ['new', '--title', 'Some fresh work', '--series', 'T', '--why', 'nothing covers it']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--checked/);
  assert.equal(fs.readdirSync(c.tickets).length, 0);
});

test('a user may create without --why or --checked', () => {
  const c = ctx(null);
  const r = run(c, ['new', '--title', 'Some fresh work', '--series', 'T']);
  assert.equal(r.code, 0, r.err);
});

test('new is refused when a strong overlap is not in --checked, and the candidates are printed', () => {
  const c = ctx();
  seed(c, { id: 'T03', title: 'Collector ticket API', why: 'routes and normaliser' });
  const refused = run(c, [
    'new', '--title', 'Collector ticket API routes', '--series', 'T',
    '--why', 'I think this is new', '--checked', 'none',
  ]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /T03/);
  assert.match(refused.err, /overlap/i);
  assert.equal(fs.readdirSync(c.tickets).length, 1);

  const allowed = run(c, [
    'new', '--title', 'Collector ticket API routes', '--series', 'T',
    '--why', 'T03 covers the read routes only', '--checked', 'T03',
  ]);
  assert.equal(allowed.code, 0, allowed.err);
  assert.equal(allowed.out.split('\n')[0].trim(), 'T04');
});

test('a fourth created_by: ai ticket in one session is refused', () => {
  const c = ctx('sess_cap');
  const titles = ['Alpha widget calibration', 'Bravo harness telemetry', 'Charlie ledger export', 'Delta cache scheduler'];
  for (let i = 0; i < 3; i++) {
    const r = run(c, ['new', '--title', titles[i], '--series', 'T', '--why', `reason ${i}`, '--checked', 'none']);
    assert.equal(r.code, 0, r.err);
  }
  const fourth = run(c, ['new', '--title', titles[3], '--series', 'T', '--why', 'one more', '--checked', 'none']);
  assert.equal(fourth.code, 1);
  assert.match(fourth.err, /cap 3/);
  assert.equal(fs.readdirSync(c.tickets).length, 3);

  // A different session is unaffected; a user is never capped.
  const other = run({ ...c, session: 'sess_other' }, ['new', '--title', titles[3], '--series', 'T', '--why', 'fresh session', '--checked', 'none']);
  assert.equal(other.code, 0, other.err);
});

test('an AI-created ticket is always planned', () => {
  const c = ctx();
  const r = run(c, ['new', '--title', 'Planned by construction', '--series', 'T', '--why', 'because', '--checked', 'none']);
  assert.equal(r.code, 0, r.err);
  const text = readTicketFile(c, 'T01');
  assert.match(text, /^status: planned$/m);
  assert.match(text, /^created_by: ai$/m);
  assert.match(text, /^created_in: sess_test$/m);
  assert.match(text, /## Verify/);
  assert.equal(run(c, ['new', '--title', 'Ready please', '--series', 'T', '--why', 'x', '--checked', 'none', '--status', 'ready']).code, 1);
});

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

test('start is refused on a blocked ticket', () => {
  const c = ctx();
  seed(c, { id: 'T01', title: 'Blocked work', status: 'blocked' });
  const r = run(c, ['start', 'T01']);
  assert.equal(r.code, 1);
  assert.match(r.err, /blocked/);
  assert.match(readTicketFile(c, 'T01'), /^status: blocked$/m);
});

test('start is refused on a ticket that is not ready', () => {
  const c = ctx();
  seed(c, { id: 'T01', title: 'Planned work', status: 'planned' });
  const r = run(c, ['start', 'T01']);
  assert.equal(r.code, 1);
  assert.match(r.err, /not ready/);
});

test('start is refused while a dependency is unfinished, and allowed with --force', () => {
  const c = ctx();
  seed(c, { id: 'T01', title: 'Schema', status: 'in progress' });
  seed(c, { id: 'T02', title: 'CLI', status: 'ready', depends: ['T01'] });
  const refused = run(c, ['start', 'T02']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /T01/);
  assert.match(readTicketFile(c, 'T02'), /^status: ready$/m);

  const forced = run(c, ['start', 'T02', '--force']);
  assert.equal(forced.code, 0, forced.err);
  assert.match(forced.out, /forced/);
  assert.match(readTicketFile(c, 'T02'), /^status: in progress$/m);
});

test('start moves a ready ticket to in progress and records the active ticket', () => {
  const c = ctx();
  seed(c, { id: 'T01', title: 'Ready work', status: 'ready' });
  const r = run(c, ['start', 'T01']);
  assert.equal(r.code, 0, r.err);
  assert.match(readTicketFile(c, 'T01'), /^status: in progress$/m);
  const state = JSON.parse(fs.readFileSync(path.join(c.home, 'tickets', 'session-sess_test.json'), 'utf8'));
  assert.equal(state.activeTicket, 'T01');
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

test('done is refused without --evidence and with an empty ## Verify', () => {
  const c = ctx(null);
  seed(c, { id: 'T01', title: 'Has verify', status: 'in progress' });
  seed(c, { id: 'T02', title: 'Empty verify', status: 'in progress', verify: '' });

  const noEvidence = run(c, ['status', 'T01', 'done']);
  assert.equal(noEvidence.code, 1);
  assert.match(noEvidence.err, /--evidence/);
  assert.match(readTicketFile(c, 'T01'), /^status: in progress$/m);

  const emptyVerify = run(c, ['status', 'T02', 'done', '--evidence', 'npm test 14/14']);
  assert.equal(emptyVerify.code, 1);
  assert.match(emptyVerify.err, /Verify/);

  const ok = run(c, ['status', 'T01', 'done', '--evidence', 'npm test 14/14']);
  assert.equal(ok.code, 0, ok.err);
  const text = readTicketFile(c, 'T01');
  assert.match(text, /^status: done$/m);
  assert.match(text, /^closed_by: user$/m);
  assert.match(text, /^closed_evidence: .*14\/14/m);
});

test('blocked requires --reason, keeps blocked_from and appends the reason', () => {
  const c = ctx(null);
  seed(c, { id: 'T01', title: 'Needs a decision', status: 'in progress' });
  assert.equal(run(c, ['status', 'T01', 'blocked']).code, 1);
  const r = run(c, ['status', 'T01', 'blocked', '--reason', 'waiting on a product decision']);
  assert.equal(r.code, 0, r.err);
  const text = readTicketFile(c, 'T01');
  assert.match(text, /^status: blocked$/m);
  assert.match(text, /^blocked_from: in progress$/m);
  assert.match(text, /Blocked — waiting on a product decision/);
  assert.match(text, /## Discoveries/);
});

test('the lifecycle table is enforced, and --reopen is the only way out of done', () => {
  const statuses = ['planned', 'ready', 'in progress', 'blocked', 'done'];
  const expected = (from, to, reopen) => {
    if (from === to) return true;
    if (from === 'done') return reopen && to !== 'blocked';
    if (to === 'planned') return true;
    if (to === 'blocked') return from === 'ready' || from === 'in progress';
    if (from === 'planned') return to === 'ready';
    if (from === 'ready') return to === 'in progress';
    if (from === 'in progress') return to === 'done';
    if (from === 'blocked') return to === 'ready' || to === 'in progress';
    return false;
  };
  for (const reopen of [false, true]) {
    for (const from of statuses) {
      if (reopen && from !== 'done') continue; // --reopen only changes the done row
      for (const to of statuses) {
        const c = ctx(null);
        seed(c, {
          id: 'T01',
          title: 'Lifecycle',
          status: from,
          // a ticket seeded as done carries its closure, so re-confirming needs no new evidence
          ...(from === 'done' ? {} : {}),
        });
        const args = ['status', 'T01', to, '--evidence', 'proof', '--reason', 'because'];
        if (reopen) args.push('--reopen');
        const r = run(c, args);
        const ok = expected(from, to, reopen);
        assert.equal(r.code === 0, ok, `${from} → ${to}${reopen ? ' --reopen' : ''}: exit ${r.code} ${r.err}`);
        if (ok) assert.match(readTicketFile(c, 'T01'), new RegExp(`^status: ${to}$`, 'm'));
        else assert.match(readTicketFile(c, 'T01'), new RegExp(`^status: ${from}$`, 'm'));
      }
    }
  }
});

test('reopen clears the closure and records it', () => {
  const c = ctx(null);
  seed(c, { id: 'T01', title: 'Closed work', status: 'in progress' });
  assert.equal(run(c, ['status', 'T01', 'done', '--evidence', 'all green']).code, 0);
  assert.equal(run(c, ['status', 'T01', 'ready']).code, 1);
  const r = run(c, ['status', 'T01', 'planned', '--reopen']);
  assert.equal(r.code, 0, r.err);
  const text = readTicketFile(c, 'T01');
  assert.match(text, /^status: planned$/m);
  assert.doesNotMatch(text, /^closed_by:/m);
  assert.match(text, /Reopened as planned/);
});

test('a user can confirm an AI-closed ticket without repeating the evidence', () => {
  const c = ctx('sess_close');
  seed(c, { id: 'T01', title: 'AI closed', status: 'in progress' });
  const byAi = run(c, ['status', 'T01', 'done', '--evidence', 'node --test 12/12']);
  assert.equal(byAi.code, 0, byAi.err);
  assert.match(readTicketFile(c, 'T01'), /^closed_by: ai$/m);
  const byUser = run(c, ['status', 'T01', 'done', '--as', 'user']);
  assert.equal(byUser.code, 0, byUser.err);
  assert.match(readTicketFile(c, 'T01'), /^closed_by: user$/m);
  assert.match(readTicketFile(c, 'T01'), /12\/12/);
});

// ---------------------------------------------------------------------------
// amend / note / split
// ---------------------------------------------------------------------------

test('amend and note append without rewriting, and the AI is held to its active ticket', () => {
  const c = ctx('sess_append');
  seed(c, { id: 'T01', title: 'Active work', status: 'ready', context: 'ORIGINAL TEXT' });
  seed(c, { id: 'T02', title: 'Other work', status: 'ready' });

  const refusedNote = run(c, ['note', 'T01', 'before any start']);
  assert.equal(refusedNote.code, 1);
  assert.match(refusedNote.err, /active ticket/);

  assert.equal(run(c, ['start', 'T01']).code, 0);
  assert.equal(run(c, ['note', 'T01', 'android blocks cleartext by default']).code, 0);
  assert.equal(run(c, ['amend', 'T01', 'the deliverable also needs a migration']).code, 0);

  const text = readTicketFile(c, 'T01');
  assert.match(text, /ORIGINAL TEXT/);
  assert.match(text, /## Discoveries/);
  assert.match(text, /android blocks cleartext by default/);
  assert.match(text, /## Amendment \(\d{4}-\d{2}-\d{2}\)/);
  assert.match(text, /the deliverable also needs a migration/);

  const wrongTicket = run(c, ['note', 'T02', 'not my ticket']);
  assert.equal(wrongTicket.code, 1);
  assert.match(wrongTicket.err, /T01/);
  // a user is not restricted
  assert.equal(run(c, ['note', 'T02', 'human note', '--as', 'user']).code, 0);
});

test('execution records a validated decision as frontmatter and a Discoveries bullet', () => {
  const c = ctx('sess_execution');
  seed(c, { id: 'T10', title: 'Policy work', status: 'ready' });
  assert.equal(run(c, ['start', 'T10']).code, 0);

  const badMode = run(c, ['execution', 'T10', '--mode', 'yolo', '--delegation', 'implementer', '--reason', 'because']);
  assert.equal(badMode.code, 2);
  assert.match(badMode.err, /--mode must be one of/);

  const badDelegation = run(c, ['execution', 'T10', '--mode', 'direct', '--delegation', 'everyone', '--reason', 'because']);
  assert.equal(badDelegation.code, 2);
  assert.match(badDelegation.err, /--delegation must be one of/);

  const missingReason = run(c, ['execution', 'T10', '--mode', 'direct', '--delegation', 'none']);
  assert.equal(missingReason.code, 2);
  assert.match(missingReason.err, /--reason/);

  const ok = run(c, [
    'execution', 'T10', '--mode', 'parallel-subagents', '--delegation', 'implementer',
    '--reason', 'two independent workstreams against a fixed contract',
  ]);
  assert.equal(ok.code, 0, ok.err);

  const text = readTicketFile(c, 'T10');
  assert.match(text, /execution_mode: parallel-subagents/);
  assert.match(text, /execution_delegation: implementer/);
  assert.match(text, /execution_reason:.*fixed contract/);
  assert.match(text, /## Discoveries/);
  assert.match(text, /Execution decision: mode=parallel-subagents; delegation=implementer/);

  // a session not holding T10 as its active ticket is refused, same guardrail as note/amend
  seed(c, { id: 'T11', title: 'Other work', status: 'ready' });
  const wrongTicket = run(c, ['execution', 'T11', '--mode', 'direct', '--delegation', 'none', '--reason', 'x']);
  assert.equal(wrongTicket.code, 1);
  assert.match(wrongTicket.err, /active ticket/);
});

test('split creates a child with split_from and notes the parent, and the AI must own the parent', () => {
  const c = ctx('sess_split');
  seed(c, { id: 'T01', title: 'Parent ticket', status: 'ready' });
  seed(c, { id: 'T02', title: 'Somebody elses ticket', status: 'ready' });

  const refused = run(c, ['split', 'T01', '--title', 'Carved out piece', '--why', 'too big', '--checked', 'none']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /active ticket/);

  assert.equal(run(c, ['start', 'T01']).code, 0);
  const wrongParent = run(c, ['split', 'T02', '--title', 'Carved out piece', '--why', 'too big', '--checked', 'none']);
  assert.equal(wrongParent.code, 1);

  const r = run(c, ['split', 'T01', '--title', 'Carved out piece', '--why', 'the parent grew a second deliverable', '--checked', 'none']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split('\n')[0].trim(), 'T03');
  const child = readTicketFile(c, 'T03');
  assert.match(child, /^split_from: T01$/m);
  assert.match(child, /^status: planned$/m);
  assert.match(readTicketFile(c, 'T01'), /Split — T03/);
});

// ---------------------------------------------------------------------------
// index / migrate
// ---------------------------------------------------------------------------

test('index rewrites only what is between the markers', () => {
  const c = ctx(null);
  seed(c, { id: 'T01', title: 'Schema', status: 'done' });
  seed(c, { id: 'T02', title: 'CLI', status: 'ready', depends: ['T03'] });
  seed(c, { id: 'T03', title: 'Collector', status: 'planned' });
  const before = '# Tickets\n\nPREAMBLE LINE\n\n<!-- agentviz:index:start -->\nstale table\n<!-- agentviz:index:end -->\n\nPOSTAMBLE LINE\n';
  const readme = path.join(c.tickets, 'README.md');
  fs.writeFileSync(readme, before);

  const r = run(c, ['index']);
  assert.equal(r.code, 0, r.err);
  const after = fs.readFileSync(readme, 'utf8');
  assert.ok(after.startsWith('# Tickets\n\nPREAMBLE LINE\n\n<!-- agentviz:index:start -->'), after);
  assert.ok(after.endsWith('<!-- agentviz:index:end -->\n\nPOSTAMBLE LINE\n'), after);
  assert.doesNotMatch(after, /stale table/);
  const middle = after.split('<!-- agentviz:index:start -->')[1].split('<!-- agentviz:index:end -->')[0];
  assert.match(middle, /\| ID \| Status \| Title \| Blocked by \|/);
  assert.match(middle, /\[T01\]\(T01-schema\.md\)/);
  assert.match(middle, /T03/); // T02's unfinished dependency shows as blocked-by
  assert.match(middle, /\| T03 \|/);
  // README is never treated as a ticket
  assert.doesNotMatch(middle, /README/);

  const missing = ctx(null);
  seed(missing, { id: 'T01', title: 'Schema' });
  fs.writeFileSync(path.join(missing.tickets, 'README.md'), '# Tickets\n\nno markers here\n');
  assert.equal(run(missing, ['index']).code, 1);
});

test('migrate adds frontmatter from legacy headers and preserves the body', () => {
  const c = ctx(null);
  const legacy = '# L01 — Legacy ticket\n\n**Status:** in progress\n**Depends on:** T01, T02\n\n## Context\n\nUNTOUCHED BODY TEXT\n\n## Verify\n\n- by hand\n';
  fs.writeFileSync(path.join(c.tickets, 'L01-legacy-ticket.md'), legacy);
  seed(c, { id: 'T01', title: 'Already migrated' });

  const r = run(c, ['migrate']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /L01/);

  const text = readTicketFile(c, 'L01');
  assert.ok(text.startsWith('---\n'), text.slice(0, 40));
  assert.match(text, /^id: L01$/m);
  assert.match(text, /^title: Legacy ticket$/m);
  assert.match(text, /^status: in progress$/m);
  assert.match(text, /^depends_on: \[T01, T02\]$/m);
  assert.match(text, /UNTOUCHED BODY TEXT/);
  assert.match(text, /\*\*Status:\*\* in progress/); // legacy line is never deleted
  assert.match(text, /# L01 — Legacy ticket/);

  // already-migrated tickets are left alone, and migrate is idempotent
  const before = readTicketFile(c, 'T01');
  assert.equal(run(c, ['migrate']).code, 0);
  assert.equal(readTicketFile(c, 'T01'), before);
});

// ---------------------------------------------------------------------------
// envelope + exit discipline
// ---------------------------------------------------------------------------

test('a mutating command sends one ticket envelope and survives a dead collector', () => {
  const c = ctx('sess_envelope');
  seed(c, { id: 'T01', title: 'Envelope work', status: 'ready' });
  const live = { AGENTVIZ_DISABLED: undefined, AGENTVIZ_PORT: '1' };

  const started = run(c, ['start', 'T01'], live);
  assert.equal(started.code, 0, started.err); // transport failure must not change the exit code
  const noted = run(c, ['note', 'T01', 'a discovery'], live);
  assert.equal(noted.code, 0, noted.err);

  const spool = path.join(c.home, 'spool', 'sess_envelope.jsonl');
  const lines = fs.readFileSync(spool, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].hook, 'Declare');
  assert.equal(lines[0].session_id, 'sess_envelope');
  assert.deepEqual(
    { ...lines[0].fields, title: undefined },
    { kind: 'ticket', action: 'start', ticketId: 'T01', status: 'in progress', actor: 'ai', title: undefined },
  );
  assert.equal(lines[1].fields.action, 'note');
  assert.equal(lines[1].fields.ticketId, 'T01');
  assert.equal(lines[1].fields.actor, 'ai');
});

test('a usage error and an unknown command exit non-zero', () => {
  const c = ctx(null);
  seed(c, { id: 'T01', title: 'Anything' });
  assert.equal(run(c, []).code, 2);
  assert.equal(run(c, ['wobble']).code, 2);
  assert.equal(run(c, ['new', '--series', 'T']).code, 2); // no --title
  assert.equal(run(c, ['status', 'T01', 'sideways']).code, 2);
  assert.equal(run(c, ['status', 'T01']).code, 2); // no target status
  assert.equal(run(c, ['list', '--as', 'robot']).code, 2);
  assert.equal(run(c, ['note', 'T01', '--as', 'user']).code, 2); // no text
});
