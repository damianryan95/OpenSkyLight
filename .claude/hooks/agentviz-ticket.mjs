#!/usr/bin/env node
/**
 * agentviz-ticket.mjs — the only way the AI writes tickets.
 *
 * `docs/tickets/<ID>-<slug>.md` is the truth; the visualiser event is a
 * notification. Every mutating command writes the file FIRST and then
 * fire-and-forgets one `Declare` envelope `{kind:'ticket', …}` through
 * agentviz-transport.mjs.
 *
 * Exit discipline (same shape as agentviz-declare.mjs, one difference):
 *   - visualiser/transport failure → exit 0 (an outage never blocks work)
 *   - guardrail refusal            → exit 1, one clear line on stderr
 *   - usage error                  → exit 2
 *
 * Usage
 *   list [--status s,s] [--series N] [--grep words]
 *   show <ID>
 *   start <ID> [--branch] [--force]
 *   new --title T --series S --why W [--checked A,B] [--depends A,B] [--related A,B]
 *   split <PARENT> --title T --why W [--checked A,B]
 *   status <ID> <status> [--evidence E] [--reason R] [--reopen]
 *   amend <ID> "text"
 *   note <ID> "text"
 *   execution <ID> --mode M --delegation D --reason "..."
 *   index
 *   migrate
 *   (any command) [--as user|ai]
 *
 * This file carries its own ~120-line copy of the frontmatter subset in
 * packages/shared/src/tickets.ts because hooks must stay zero-dependency.
 * Keep the two in sync (docs/INTEGRATION.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { agentvizHome, baseEnvelope, isDisabled, preview, send } from './agentviz-transport.mjs';

// ---------------------------------------------------------------------------
// ticket model — mirror of packages/shared/src/tickets.ts
// ---------------------------------------------------------------------------

const TICKET_STATUSES = ['planned', 'ready', 'in progress', 'blocked', 'done'];
const KNOWN_KEYS = [
  'id', 'title', 'status', 'depends_on', 'related', 'created_by', 'created_at', 'created_in',
  'why', 'checked', 'execution_mode', 'execution_delegation', 'execution_reason',
  'split_from', 'blocked_from', 'closed_by', 'closed_evidence',
];
const LIST_KEYS = new Set(['depends_on', 'related', 'checked']);
// Mirror of packages/shared/src/tickets.ts EXECUTION_MODES/EXECUTION_DELEGATIONS (CLAUDE.md's ladder).
const EXECUTION_MODES = ['direct', 'tool', 'skill', 'subagent', 'parallel-subagents', 'team'];
const EXECUTION_DELEGATIONS = ['none', 'investigator', 'implementer', 'debugger', 'architect', 'verifier', 'security', 'mixed'];
function isExecutionMode(v) { return typeof v === 'string' && EXECUTION_MODES.includes(v); }
function isExecutionDelegation(v) { return typeof v === 'string' && EXECUTION_DELEGATIONS.includes(v); }
const ID_RE = /^[A-Za-z]{1,6}\d{1,4}$/;
const SLUG_MAX = 40;
const DUPLICATE_THRESHOLD = 0.6;

function stripQuotes(raw) {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    const inner = s.slice(1, -1);
    return { value: s[0] === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replace(/''/g, "'"), quoted: true };
  }
  return { value: s, quoted: false };
}

function parseList(raw) {
  const s = String(raw ?? '').trim();
  const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  return inner
    .split(',')
    .map((p) => stripQuotes(p).value)
    .filter((p) => p.length > 0 && p !== '-' && p.toLowerCase() !== 'none');
}

function parseScalar(raw) {
  const { value, quoted } = stripQuotes(raw);
  if (quoted) return value;
  return value.replace(/\s+#.*$/, '').trim();
}

function parseFrontmatter(md) {
  const text = String(md).replace(/^\uFEFF/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, order: [], body: text, found: false };
  const data = {};
  const order = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2];
    if (!(key in data)) order.push(key);
    data[key] = LIST_KEYS.has(key) || /^\[.*\]$/.test(raw.trim()) ? parseList(raw) : parseScalar(raw);
  }
  return { data, order, body: text.slice(m[0].length), found: true };
}

function needsQuote(s) {
  if (s === '') return true;
  if (/^[\s>|*&!%@`#?{}[\],'"-]/.test(s)) return true;
  if (/[\n\r]/.test(s)) return true;
  if (/:\s/.test(s) || /:$/.test(s)) return true;
  if (/\s#/.test(s)) return true;
  if (/\s$/.test(s)) return true;
  return false;
}

function emitScalar(s) {
  return needsQuote(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"` : s;
}

function emitList(list) {
  return `[${list.map((v) => emitScalar(v)).join(', ')}]`;
}

function isTicketStatus(v) {
  return typeof v === 'string' && TICKET_STATUSES.includes(v);
}

function normaliseStatus(raw) {
  if (!raw) return undefined;
  const s = String(raw).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.:;]+$/, '');
  if (isTicketStatus(s)) return s;
  switch (s) {
    case 'todo': case 'to do': case 'backlog': case 'open': case 'new': return 'planned';
    case 'next': case 'ready to start': return 'ready';
    case 'wip': case 'doing': case 'active': case 'started': return 'in progress';
    case 'on hold': case 'waiting': case 'stalled': return 'blocked';
    case 'complete': case 'completed': case 'closed': case 'shipped': case 'merged': return 'done';
    default: return undefined;
  }
}

/** planned → ready → in progress → done; blocked off ready/in progress; anything → planned. */
function canTransition(from, to, opts = {}) {
  if (from === to) return true;
  if (from === 'done') return opts.reopen === true && to !== 'blocked';
  if (to === 'planned') return true;
  if (to === 'blocked') return from === 'ready' || from === 'in progress';
  switch (from) {
    case 'planned': return to === 'ready';
    case 'ready': return to === 'in progress';
    case 'in progress': return to === 'done';
    case 'blocked': return to === 'ready' || to === 'in progress';
    default: return false;
  }
}

function allowedTransitions(from, opts = {}) {
  return TICKET_STATUSES.filter((to) => to !== from && canTransition(from, to, opts));
}

function slugifyTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '') || 'ticket';
}

function splitTicketId(id) {
  const m = /^([A-Za-z]{1,6})(\d{1,4})$/.exec(String(id).trim());
  return m ? { series: m[1].toUpperCase(), number: Number(m[2]) } : undefined;
}

function nextTicketId(existing, series) {
  let max = 0;
  let width = 2;
  for (const id of existing) {
    const parts = splitTicketId(id);
    if (!parts) continue;
    if (parts.number > max) max = parts.number;
    const digits = String(parts.number).length;
    if (digits > width) width = digits;
  }
  const next = String(max + 1);
  return `${String(series).trim().toUpperCase()}${next.padStart(Math.max(width, next.length), '0')}`;
}

function isTicketId(v) {
  return ID_RE.test(String(v).trim());
}

function parseSections(body) {
  const out = {};
  let heading;
  let buf = [];
  const flush = () => {
    if (heading === undefined) return;
    const text = buf.join('\n').trim();
    out[heading] = heading in out ? `${out[heading]}\n\n${text}`.trim() : text;
    buf = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { flush(); heading = h[1]; continue; }
    if (heading !== undefined) buf.push(line);
  }
  flush();
  return out;
}

function sectionOf(sections, name) {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(sections)) if (k.toLowerCase() === target) return v;
  for (const [k, v] of Object.entries(sections)) if (k.toLowerCase().startsWith(target)) return v;
  return undefined;
}

const LEGACY_STATUS_RE = /^\s*\*\*Status:?\*\*\s*(.+?)\s*$/im;
const LEGACY_DEPENDS_RE = /^\s*\*\*Depends on:?\*\*\s*(.+?)\s*$/im;
const LEGACY_TITLE_RE = /^#\s+(?:[A-Za-z]{1,6}\d{1,4}\s*[\u2014:-]\s*)?(.+?)\s*$/m;

function idFromPath(p) {
  const base = String(p).replace(/\\/g, '/').split('/').pop() ?? p;
  const m = /^([A-Za-z]{1,6}\d{1,4})-/.exec(base);
  return m ? m[1].toUpperCase() : undefined;
}

function asString(v) {
  return typeof v === 'string' && v.length ? v : undefined;
}

function asList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return parseList(v);
  return [];
}

function asActor(v, fallback) {
  const s = asString(v)?.toLowerCase();
  return s === 'ai' || s === 'user' ? s : fallback;
}

/** Parse one ticket file. Frontmatter is authoritative; legacy headers are the fallback. */
function parseTicket(md, p) {
  const fm = parseFrontmatter(md);
  const warnings = [];
  const body = fm.body;
  const sections = parseSections(body);

  const id = asString(fm.data.id) ?? idFromPath(p) ?? '';
  if (!id) warnings.push('no id in frontmatter and none in the filename');

  let title = asString(fm.data.title);
  if (!title) {
    title = LEGACY_TITLE_RE.exec(body)?.[1];
    if (!title) {
      const base = (String(p).replace(/\\/g, '/').split('/').pop() ?? p).replace(/\.md$/i, '');
      title = base.replace(/^[A-Za-z]{1,6}\d{1,4}-/, '').replace(/-/g, ' ').trim() || id;
      warnings.push('no title in frontmatter or first heading; derived from the filename');
    }
  }

  const rawStatus = asString(fm.data.status) ?? LEGACY_STATUS_RE.exec(body)?.[1];
  const status = normaliseStatus(rawStatus);
  if (!status && rawStatus) warnings.push(`unrecognised status "${rawStatus}"; treated as planned`);
  if (!rawStatus) warnings.push('no status found; treated as planned');

  const legacyDepends = LEGACY_DEPENDS_RE.exec(body)?.[1];
  const depends_on = fm.data.depends_on !== undefined
    ? asList(fm.data.depends_on)
    : (legacyDepends
      ? legacyDepends.split(/[,\s]+/).map((s) => s.replace(/[^A-Za-z0-9]/g, '')).filter(isTicketId)
      : []);
  if (fm.data.depends_on === undefined && legacyDepends && depends_on.length === 0) {
    warnings.push(`could not read dependencies from "${legacyDepends}"`);
  }

  const extra = {};
  for (const key of fm.order) {
    if (KNOWN_KEYS.includes(key)) continue;
    extra[key] = fm.data[key];
  }

  const rawExecutionMode = asString(fm.data.execution_mode);
  if (rawExecutionMode && !isExecutionMode(rawExecutionMode)) {
    warnings.push(`unrecognised execution_mode "${rawExecutionMode}"; ignored`);
  }
  const rawExecutionDelegation = asString(fm.data.execution_delegation);
  if (rawExecutionDelegation && !isExecutionDelegation(rawExecutionDelegation)) {
    warnings.push(`unrecognised execution_delegation "${rawExecutionDelegation}"; ignored`);
  }

  return {
    id,
    title,
    status: status ?? 'planned',
    depends_on,
    related: asList(fm.data.related),
    created_by: asActor(fm.data.created_by, 'user'),
    created_at: asString(fm.data.created_at),
    created_in: asString(fm.data.created_in),
    why: asString(fm.data.why),
    checked: asList(fm.data.checked),
    execution_mode: isExecutionMode(rawExecutionMode) ? rawExecutionMode : undefined,
    execution_delegation: isExecutionDelegation(rawExecutionDelegation) ? rawExecutionDelegation : undefined,
    execution_reason: asString(fm.data.execution_reason),
    split_from: asString(fm.data.split_from),
    blocked_from: normaliseStatus(asString(fm.data.blocked_from)),
    closed_by: asString(fm.data.closed_by) ? asActor(fm.data.closed_by, 'user') : undefined,
    closed_evidence: asString(fm.data.closed_evidence),
    path: p,
    body,
    sections,
    blockedBy: [],
    extra,
    warnings,
    hasFrontmatter: fm.found,
  };
}

function serialiseTicket(t) {
  const lines = ['---'];
  const put = (k, v) => { if (v !== undefined && v !== '') lines.push(`${k}: ${emitScalar(String(v))}`); };
  put('id', t.id);
  put('title', t.title);
  put('status', t.status);
  lines.push(`depends_on: ${emitList(t.depends_on ?? [])}`);
  lines.push(`related: ${emitList(t.related ?? [])}`);
  put('created_by', t.created_by);
  put('created_at', t.created_at);
  put('created_in', t.created_in);
  put('why', t.why);
  lines.push(`checked: ${emitList(t.checked ?? [])}`);
  put('execution_mode', t.execution_mode);
  put('execution_delegation', t.execution_delegation);
  put('execution_reason', t.execution_reason);
  put('split_from', t.split_from);
  put('blocked_from', t.blocked_from);
  put('closed_by', t.closed_by);
  put('closed_evidence', t.closed_evidence);
  for (const [k, v] of Object.entries(t.extra ?? {})) {
    if (Array.isArray(v)) lines.push(`${k}: ${emitList(v)}`);
    else put(k, v);
  }
  lines.push('---');
  return `${lines.join('\n')}\n${t.body}`;
}

function linkTickets(tickets) {
  const byId = new Map(tickets.map((t) => [t.id.toUpperCase(), t]));
  for (const t of tickets) {
    t.blockedBy = t.depends_on.filter((d) => {
      const dep = byId.get(d.toUpperCase());
      return !dep || dep.status !== 'done';
    });
  }
  return tickets;
}

function compareTickets(a, b) {
  const sa = TICKET_STATUSES.indexOf(a.status);
  const sb = TICKET_STATUSES.indexOf(b.status);
  if (sa !== sb) return sa - sb;
  const na = splitTicketId(a.id);
  const nb = splitTicketId(b.id);
  if (na && nb && na.series !== nb.series) return na.series.localeCompare(nb.series);
  if (na && nb) return na.number - nb.number;
  return a.id.localeCompare(b.id);
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'from', 'by', 'at', 'as',
  'is', 'be', 'it', 'its', 'this', 'that', 'add', 'make', 'use', 'via', 'into', 'when', 'not',
]);

function titleWords(s) {
  return [...new Set(
    String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )];
}

/** 0–1 overlap of the query's significant words with a ticket's title + why. */
function overlapScore(query, ticket) {
  const q = titleWords(query);
  if (!q.length) return 0;
  const hay = new Set(titleWords(`${ticket.title} ${ticket.why ?? ''}`));
  let hits = 0;
  for (const w of q) if (hay.has(w)) hits++;
  return hits / q.length;
}

// ---------------------------------------------------------------------------
// errors, argv, actor, locations
// ---------------------------------------------------------------------------

/** A guardrail said no. Exit 1 so the Curator sees it. */
class Refusal extends Error {
  constructor(message, detail = []) { super(message); this.detail = detail; this.exitCode = 1; }
}
/** The command was malformed. Exit 2. */
class Usage extends Error {
  constructor(message) { super(message); this.detail = []; this.exitCode = 2; }
}

const BOOL_FLAGS = new Set(['force', 'branch', 'reopen', 'all', 'help']);

/** `--k v`, `--k=v`, and the boolean flags above. Everything else is positional. */
function parseArgv(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      let key = a.slice(2);
      let val;
      const eq = key.indexOf('=');
      if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
      if (val !== undefined) opts[key] = val;
      else if (BOOL_FLAGS.has(key)) opts[key] = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
      else opts[key] = true;
    } else pos.push(a);
  }
  return { opts, pos };
}

function optString(opts, key) {
  const v = opts[key];
  if (v === undefined || v === true) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function sessionId() {
  return process.env.CLAUDE_CODE_SESSION_ID || undefined;
}

/** `CLAUDE_CODE_SESSION_ID` set → ai, otherwise user. `--as user` overrides. */
function resolveActor(opts) {
  const override = optString(opts, 'as');
  if (override) {
    const a = override.toLowerCase();
    if (a !== 'user' && a !== 'ai') throw new Usage(`--as must be "user" or "ai", not "${override}"`);
    return a;
  }
  return sessionId() ? 'ai' : 'user';
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function gitRoot() {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? path.normalize(out) : undefined;
  } catch { return undefined; }
}

/** `docs/tickets/` under the git root; `AGENTVIZ_TICKETS_DIR` wins; cwd is the fallback. */
function ticketsDir() {
  const override = process.env.AGENTVIZ_TICKETS_DIR;
  if (override) return path.resolve(override);
  const root = gitRoot();
  if (root) return path.join(root, 'docs', 'tickets');
  let cur = path.resolve(process.cwd());
  for (;;) {
    const cand = path.join(cur, 'docs', 'tickets');
    if (isDir(cand)) return cand;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return path.join(process.cwd(), 'docs', 'tickets');
}

function requireDir(dir) {
  if (!isDir(dir)) throw new Refusal(`no tickets directory at ${dir} (set AGENTVIZ_TICKETS_DIR or create it)`);
  return dir;
}

function readTickets(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names.sort()) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    if (name.toLowerCase() === 'readme.md') continue;
    const full = path.join(dir, name);
    let raw;
    try { raw = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const t = parseTicket(raw, name);
    t.file = full;
    t.raw = raw;
    out.push(t);
  }
  return linkTickets(out);
}

function findTicket(tickets, id) {
  const want = String(id ?? '').trim().toUpperCase();
  if (!want) throw new Usage('a ticket id is required');
  const t = tickets.find((x) => x.id.toUpperCase() === want);
  if (!t) throw new Refusal(`no ticket ${want} in the tickets directory`);
  return t;
}

/** Always `\n`, always a trailing newline. */
function writeTicket(t) {
  const text = serialiseTicket(t).replace(/\r\n/g, '\n');
  fs.writeFileSync(t.file, text.endsWith('\n') ? text : `${text}\n`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Append a bullet at the end of `## <heading>`, creating the section if absent. */
function appendBullet(body, heading, line) {
  const lines = body.split('\n');
  const re = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, 'i');
  const idx = lines.findIndex((l) => re.test(l));
  if (idx === -1) return `${body.replace(/\n+$/, '')}\n\n## ${heading}\n\n${line}\n`;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) { if (/^##\s+/.test(lines[i])) { end = i; break; } }
  let last = end;
  while (last > idx + 1 && lines[last - 1].trim() === '') last--;
  const head = lines.slice(0, last);
  const tail = lines.slice(end);
  const sectionEmpty = last === idx + 1;
  const merged = [...head, ...(sectionEmpty ? [''] : []), line, '', ...tail];
  const text = merged.join('\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** Append a new `## <heading>` section at the end of the body. Never rewrites. */
function appendSection(body, heading, text) {
  return `${body.replace(/\n+$/, '')}\n\n## ${heading}\n\n${text.trim()}\n`;
}

// ---------------------------------------------------------------------------
// session state (agentviz home, not the repo)
// ---------------------------------------------------------------------------

function sessionStateFile(id) {
  const safe = String(id || 'local').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return path.join(agentvizHome(), 'tickets', `session-${safe}.json`);
}

function readSessionState() {
  try { return JSON.parse(fs.readFileSync(sessionStateFile(sessionId()), 'utf8')); } catch { return {}; }
}

function writeSessionState(state) {
  try {
    const file = sessionStateFile(sessionId());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  } catch { /* session state is a convenience, never a blocker */ }
}

/** The ticket this session last `start`ed. */
function activeTicketId() {
  const s = readSessionState();
  return typeof s.activeTicket === 'string' && s.activeTicket ? s.activeTicket.toUpperCase() : undefined;
}

function requireActiveTicket(actor, ticket, verb) {
  if (actor !== 'ai') return;
  const active = activeTicketId();
  if (!active) {
    throw new Refusal(`${verb} is restricted to this session's active ticket; none is started (run: start <ID>)`);
  }
  if (active !== ticket.id.toUpperCase()) {
    throw new Refusal(`${verb} is restricted to this session's active ticket ${active}, not ${ticket.id}`);
  }
}

// ---------------------------------------------------------------------------
// envelope
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget one `Declare` envelope. The file is already written; a
 * transport failure must never change the exit code.
 */
async function declareTicket(fields) {
  try {
    if (isDisabled()) return 'disabled';
    const envelope = baseEnvelope('Declare', process.env.CLAUDE_CODE_SESSION_ID, {
      agent_id: process.env.CLAUDE_CODE_AGENT_ID,
      fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    });
    return await send(envelope);
  } catch {
    return 'dropped';
  }
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function pad(s, n) {
  const v = String(s);
  return v.length >= n ? v : v + ' '.repeat(n - v.length);
}

function cmdList(pos, opts) {
  const dir = requireDir(ticketsDir());
  let tickets = readTickets(dir);

  const statusFilter = optString(opts, 'status');
  if (statusFilter) {
    const wanted = new Set();
    for (const part of statusFilter.split(',')) {
      const s = normaliseStatus(part);
      if (!s) throw new Usage(`unknown status "${part.trim()}" in --status`);
      wanted.add(s);
    }
    tickets = tickets.filter((t) => wanted.has(t.status));
  }

  const series = optString(opts, 'series');
  if (series) {
    const want = series.toUpperCase();
    tickets = tickets.filter((t) => (splitTicketId(t.id)?.series ?? '') === want);
  }

  // `--grep parent app pairing` — unquoted extra words belong to the query.
  const grep = [optString(opts, 'grep'), ...(opts.grep !== undefined ? pos : [])].filter(Boolean).join(' ').trim();
  if (grep) {
    tickets = tickets
      .map((t) => ({ t, score: overlapScore(grep, t) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || compareTickets(a.t, b.t))
      .map((r) => Object.assign(r.t, { score: r.score }));
  } else {
    tickets.sort(compareTickets);
  }

  if (!tickets.length) { console.log('no tickets match'); return 0; }

  const idW = Math.max(2, ...tickets.map((t) => t.id.length));
  const stW = Math.max(6, ...tickets.map((t) => t.status.length));
  for (const t of tickets) {
    const blocked = t.blockedBy.length ? `  blocked-by: ${t.blockedBy.join(', ')}` : '';
    const score = grep ? `  (${t.score.toFixed(2)})` : '';
    const ai = t.created_by === 'ai' ? ' [ai]' : '';
    console.log(`${pad(t.id, idW)}  ${pad(t.status, stW)}  ${t.title}${ai}${blocked}${score}`);
  }
  return 0;
}

function cmdShow(pos) {
  const dir = requireDir(ticketsDir());
  const t = findTicket(readTickets(dir), pos[0]);
  process.stdout.write(t.raw.endsWith('\n') ? t.raw : `${t.raw}\n`);
  return 0;
}

async function cmdStart(pos, opts, actor) {
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  const t = findTicket(tickets, pos[0]);
  const forced = opts.force === true;

  const reasons = [];
  if (t.status === 'blocked') reasons.push(`${t.id} is blocked`);
  else if (t.status !== 'ready' && t.status !== 'in progress') reasons.push(`${t.id} is ${t.status}, not ready`);
  if (t.blockedBy.length) reasons.push(`unfinished dependencies: ${t.blockedBy.join(', ')}`);
  if (reasons.length && !forced) {
    throw new Refusal(`cannot start ${t.id} — ${reasons.join('; ')} (use --force to override; the force is recorded)`);
  }

  const before = t.status;
  if (t.status !== 'in progress') {
    t.status = 'in progress';
    t.blocked_from = undefined;
    writeTicket(t);
  }

  const state = readSessionState();
  const prev = typeof state.activeTicket === 'string' ? state.activeTicket : undefined;
  const switched = prev && prev.toUpperCase() !== t.id.toUpperCase();
  writeSessionState({
    ...state,
    sessionId: sessionId() ?? null,
    activeTicket: t.id,
    activeSince: new Date().toISOString(),
    switches: (Number(state.switches) || 0) + (switched ? 1 : 0),
    previousTicket: switched ? prev : state.previousTicket,
  });

  let branchNote = '';
  if (opts.branch === true) {
    const branch = `ticket/${t.id}-${slugifyTitle(t.title)}`;
    try {
      execFileSync('git', ['switch', '-c', branch], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] });
      branchNote = ` on branch ${branch}`;
    } catch (err) {
      // A branch is a convenience, not a guardrail: warn and carry on.
      const msg = String(err?.stderr ?? err?.message ?? '').split('\n')[0].trim();
      console.error(`agentviz-ticket: could not create branch ${branch}${msg ? ` (${msg})` : ''}`);
    }
  }

  const outcome = await declareTicket({
    kind: 'ticket',
    action: 'start',
    ticketId: t.id,
    title: preview(t.title, 200),
    status: t.status,
    actor,
    forced: forced && reasons.length ? true : undefined,
  });
  console.log(`agentviz-ticket: started ${t.id} (${before} → ${t.status})${branchNote}${switched ? ` [switched from ${prev}]` : ''}${forced && reasons.length ? ' [forced]' : ''}${outcome === 'sent' || outcome === 'disabled' ? '' : ` (${outcome})`}`);
  return 0;
}

const TEMPLATE_SECTIONS = ['Context', 'Deliverable', 'Likely files', 'Acceptance', 'Verify'];

function templateBody(why) {
  const parts = [''];
  for (const s of TEMPLATE_SECTIONS) {
    parts.push(`## ${s}`, '');
    if (s === 'Context' && why) parts.push(why, '');
  }
  return parts.join('\n');
}

/** Shared by `new` and `split`. Returns the created ticket. */
function createTicket({ dir, tickets, actor, opts, splitFrom }) {
  const title = optString(opts, 'title');
  if (!title) throw new Usage('--title is required');
  const series = optString(opts, 'series') ?? (splitFrom ? splitTicketId(splitFrom)?.series : undefined);
  if (!series) throw new Usage('--series is required');
  if (!/^[A-Za-z]{1,6}$/.test(series)) throw new Usage(`--series must be 1-6 letters, not "${series}"`);

  const why = optString(opts, 'why');
  const checkedRaw = opts.checked;
  if (actor === 'ai') {
    if (!why) throw new Refusal('--why is mandatory for an AI actor: say why this cannot be attributed to an existing ticket');
    if (checkedRaw === undefined || checkedRaw === true || String(checkedRaw).trim() === '') {
      throw new Refusal('--checked is mandatory for an AI actor: list the tickets examined first (use --checked none if truly nothing is related)');
    }
  }
  const checked = checkedRaw === undefined || checkedRaw === true ? [] : parseList(String(checkedRaw));

  // Duplicate guardrail: word overlap of the title against every existing ticket.
  const checkedSet = new Set(checked.map((c) => c.toUpperCase()));
  const candidates = tickets
    .map((t) => ({ t, score: overlapScore(title, t) }))
    .filter((r) => r.score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  const unchecked = candidates.filter((r) => !checkedSet.has(r.t.id.toUpperCase()));
  if (unchecked.length) {
    throw new Refusal(
      `"${title}" strongly overlaps ${unchecked.length} existing ticket(s) not listed in --checked`,
      [
        ...unchecked.map((r) => `  ${pad(r.t.id, 6)} ${r.score.toFixed(2)}  ${r.t.status.padEnd(11)}  ${r.t.title}`),
        '  attribute the work to one of these, or re-run with them in --checked',
      ],
    );
  }

  // Cap: 3 `created_by: ai` tickets per session, counted from the files themselves.
  const sid = sessionId();
  if (actor === 'ai' && sid) {
    const mine = tickets.filter((t) => t.created_by === 'ai' && t.created_in === sid);
    if (mine.length >= 3) {
      throw new Refusal(
        `this session has already created ${mine.length} tickets (cap 3): ${mine.map((t) => t.id).join(', ')}`,
        ['  fold the work into an existing ticket, or ask the user to raise the next one'],
      );
    }
  }

  let status = 'planned';
  const wanted = optString(opts, 'status');
  if (wanted) {
    if (actor === 'ai') throw new Refusal('an AI-created ticket is always planned; only a user moves it to ready');
    const s = normaliseStatus(wanted);
    if (!s) throw new Usage(`unknown status "${wanted}"`);
    status = s;
  }

  const id = nextTicketId(tickets.map((t) => t.id), series);
  const file = path.join(dir, `${id}-${slugifyTitle(title)}.md`);
  if (fs.existsSync(file)) throw new Refusal(`${path.basename(file)} already exists`);

  const ticket = {
    id,
    title,
    status,
    depends_on: parseList(optString(opts, 'depends') ?? optString(opts, 'depends-on') ?? ''),
    related: parseList(optString(opts, 'related') ?? ''),
    created_by: actor,
    created_at: today(),
    created_in: actor === 'ai' ? sid : undefined,
    why,
    checked,
    split_from: splitFrom,
    body: templateBody(why),
    extra: {},
    file,
  };
  writeTicket(ticket);
  return ticket;
}

async function cmdNew(pos, opts, actor) {
  if (pos.length) throw new Usage(`unexpected argument "${pos[0]}" — quote multi-word values (--why "…")`);
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  const t = createTicket({ dir, tickets, actor, opts });
  const outcome = await declareTicket({
    kind: 'ticket',
    action: 'create',
    ticketId: t.id,
    title: preview(t.title, 200),
    status: t.status,
    actor,
    why: t.why ? preview(t.why, 300) : undefined,
    checked: t.checked.length ? t.checked : undefined,
  });
  console.log(`${t.id}`);
  console.log(`agentviz-ticket: created ${t.id} (${t.status}) at ${path.relative(process.cwd(), t.file) || t.file}${outcome === 'sent' || outcome === 'disabled' ? '' : ` (${outcome})`}`);
  return 0;
}

async function cmdSplit(pos, opts, actor) {
  if (pos.length > 1) throw new Usage(`unexpected argument "${pos[1]}" — quote multi-word values (--why "…")`);
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  const parent = findTicket(tickets, pos[0]);
  requireActiveTicket(actor, parent, 'split');

  const child = createTicket({ dir, tickets, actor, opts, splitFrom: parent.id });

  // Append a dated Split note to the parent; its existing text is untouched.
  parent.body = appendBullet(parent.body, 'Discoveries', `- ${today()}: Split — ${child.id} (${child.title}) carved out of this ticket.`);
  writeTicket(parent);

  const outcome = await declareTicket({
    kind: 'ticket',
    action: 'split',
    ticketId: child.id,
    title: preview(child.title, 200),
    status: child.status,
    actor,
    why: child.why ? preview(child.why, 300) : undefined,
    checked: child.checked.length ? child.checked : undefined,
    splitFrom: parent.id,
  });
  console.log(`${child.id}`);
  console.log(`agentviz-ticket: split ${parent.id} → ${child.id} (${child.status})${outcome === 'sent' || outcome === 'disabled' ? '' : ` (${outcome})`}`);
  return 0;
}

async function cmdStatus(pos, opts, actor) {
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  const t = findTicket(tickets, pos[0]);
  const rawTarget = pos.slice(1).join(' ').trim();
  if (!rawTarget) throw new Usage(`a target status is required: ${TICKET_STATUSES.join(' | ')}`);
  const target = normaliseStatus(rawTarget);
  if (!target) throw new Usage(`unknown status "${rawTarget}" (${TICKET_STATUSES.join(' | ')})`);

  const reopen = opts.reopen === true;
  const from = t.status;
  if (!canTransition(from, target, { reopen })) {
    const allowed = allowedTransitions(from, { reopen });
    throw new Refusal(
      `cannot move ${t.id} from ${from} to ${target}`,
      [`  allowed from ${from}: ${allowed.length ? allowed.join(', ') : 'nothing without --reopen'}${from === 'done' && !reopen ? ' (use --reopen)' : ''}`],
    );
  }

  const evidence = optString(opts, 'evidence');
  const reason = optString(opts, 'reason');

  if (target === 'done') {
    const keptEvidence = from === 'done' ? t.closed_evidence : undefined;
    if (!evidence && !keptEvidence) {
      throw new Refusal(`${t.id} cannot be done without --evidence (what was run, and what it showed)`);
    }
    const verify = sectionOf(t.sections, 'verify');
    if (!verify || !verify.trim()) {
      throw new Refusal(`${t.id} has no non-empty "## Verify" section; say how it is verified before closing it`);
    }
    t.closed_by = actor;
    t.closed_evidence = evidence ?? keptEvidence;
  }

  if (target === 'blocked') {
    if (!reason) throw new Refusal(`${t.id} cannot be blocked without --reason`);
    t.blocked_from = from;
    t.body = appendBullet(t.body, 'Discoveries', `- ${today()}: Blocked — ${reason}`);
  } else if (from === 'blocked') {
    t.blocked_from = undefined;
  }

  if (from === 'done' && target !== 'done') {
    t.closed_by = undefined;
    t.closed_evidence = undefined;
    t.body = appendBullet(t.body, 'Discoveries', `- ${today()}: Reopened as ${target}${reason ? ` — ${reason}` : ''}.`);
  }

  t.status = target;
  writeTicket(t);

  const outcome = await declareTicket({
    kind: 'ticket',
    action: 'status',
    ticketId: t.id,
    title: preview(t.title, 200),
    status: target,
    actor,
    evidence: target === 'done' ? preview(t.closed_evidence ?? '', 300) : undefined,
    reason: reason ? preview(reason, 300) : undefined,
  });
  console.log(`agentviz-ticket: ${t.id} ${from} → ${target}${outcome === 'sent' || outcome === 'disabled' ? '' : ` (${outcome})`}`);
  return 0;
}

async function cmdAmend(pos, opts, actor) {
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  const t = findTicket(tickets, pos[0]);
  const text = pos.slice(1).join(' ').trim() || optString(opts, 'text');
  if (!text) throw new Usage('amend needs text: amend <ID> "what changed and why"');
  requireActiveTicket(actor, t, 'amend');

  t.body = appendSection(t.body, `Amendment (${today()})`, text);
  writeTicket(t);

  const outcome = await declareTicket({
    kind: 'ticket', action: 'amend', ticketId: t.id, title: preview(t.title, 200), status: t.status, actor,
    why: preview(text, 300),
  });
  console.log(`agentviz-ticket: amended ${t.id}${outcome === 'sent' || outcome === 'disabled' ? '' : ` (${outcome})`}`);
  return 0;
}

async function cmdNote(pos, opts, actor) {
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  const t = findTicket(tickets, pos[0]);
  const text = pos.slice(1).join(' ').trim() || optString(opts, 'text');
  if (!text) throw new Usage('note needs text: note <ID> "what you discovered"');
  requireActiveTicket(actor, t, 'note');

  t.body = appendBullet(t.body, 'Discoveries', `- ${today()}: ${text}`);
  writeTicket(t);

  const outcome = await declareTicket({
    kind: 'ticket', action: 'note', ticketId: t.id, title: preview(t.title, 200), status: t.status, actor,
    why: preview(text, 300),
  });
  console.log(`agentviz-ticket: noted on ${t.id}${outcome === 'sent' || outcome === 'disabled' ? '' : ` (${outcome})`}`);
  return 0;
}

/**
 * Records the declared execution decision from .claude/rules/delegation.md as
 * structured frontmatter (not just a free-text Discoveries bullet), so a policy
 * check can compare it against observed runtime behaviour without parsing prose.
 */
async function cmdExecution(pos, opts, actor) {
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  const t = findTicket(tickets, pos[0]);
  requireActiveTicket(actor, t, 'execution');

  const mode = optString(opts, 'mode');
  const delegation = optString(opts, 'delegation');
  const reason = optString(opts, 'reason');
  if (!mode) throw new Usage(`execution needs --mode: one of ${EXECUTION_MODES.join('|')}`);
  if (!isExecutionMode(mode)) throw new Usage(`--mode must be one of ${EXECUTION_MODES.join('|')}, not "${mode}"`);
  if (!delegation) throw new Usage(`execution needs --delegation: one of ${EXECUTION_DELEGATIONS.join('|')}`);
  if (!isExecutionDelegation(delegation)) throw new Usage(`--delegation must be one of ${EXECUTION_DELEGATIONS.join('|')}, not "${delegation}"`);
  if (!reason) throw new Usage('execution needs --reason: one sentence tied to .claude/rules/delegation.md');

  t.execution_mode = mode;
  t.execution_delegation = delegation;
  t.execution_reason = reason;
  t.body = appendBullet(t.body, 'Discoveries', `- ${today()}: Execution decision: mode=${mode}; delegation=${delegation}; reason=${reason}`);
  writeTicket(t);

  const outcome = await declareTicket({
    kind: 'ticket', action: 'execution', ticketId: t.id, title: preview(t.title, 200), status: t.status, actor,
    executionMode: mode, executionDelegation: delegation, reason: preview(reason, 300),
  });
  console.log(`agentviz-ticket: recorded execution decision on ${t.id} (mode=${mode}, delegation=${delegation})${outcome === 'sent' || outcome === 'disabled' ? '' : ` (${outcome})`}`);
  return 0;
}

const INDEX_START = '<!-- agentviz:index:start -->';
const INDEX_END = '<!-- agentviz:index:end -->';

function indexTable(tickets) {
  const rows = [...tickets].sort(compareTickets).map((t) => {
    const blocked = t.blockedBy.length ? t.blockedBy.join(', ') : '—';
    const link = `[${t.id}](${path.basename(t.file ?? t.path)})`;
    const who = t.created_by === 'ai' ? ' (ai)' : '';
    return `| ${link} | ${t.status} | ${t.title.replace(/\|/g, '\\|')}${who} | ${blocked} |`;
  });
  return [
    '| ID | Status | Title | Blocked by |',
    '| --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| — | — | no tickets | — |']),
  ].join('\n');
}

function cmdIndex() {
  const dir = requireDir(ticketsDir());
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) throw new Refusal(`no ${path.relative(process.cwd(), readme) || readme} to write the index into`);
  const text = fs.readFileSync(readme, 'utf8');
  const re = new RegExp(`(${escapeRe(INDEX_START)})([\\s\\S]*?)(${escapeRe(INDEX_END)})`);
  if (!re.test(text)) {
    throw new Refusal(`${path.basename(readme)} has no ${INDEX_START} / ${INDEX_END} markers`);
  }
  const tickets = readTickets(dir);
  const table = indexTable(tickets);
  const out = text.replace(re, (_m, a, _mid, b) => `${a}\n\n${table}\n\n${b}`);
  if (out !== text) fs.writeFileSync(readme, out.replace(/\r\n/g, '\n'));
  console.log(`agentviz-ticket: indexed ${tickets.length} ticket(s) into ${path.basename(readme)}${out === text ? ' (unchanged)' : ''}`);
  return 0;
}

function cmdMigrate() {
  const dir = requireDir(ticketsDir());
  const tickets = readTickets(dir);
  let migrated = 0;
  let skipped = 0;
  for (const t of tickets) {
    if (t.hasFrontmatter) continue;
    if (!t.id) {
      skipped++;
      console.log(`  skipped ${path.basename(t.file)}: could not infer an id from the filename`);
      continue;
    }
    // The body is carried over byte-for-byte; only a header is added.
    t.created_by = t.created_by ?? 'user';
    writeTicket(t);
    migrated++;
    console.log(`  ${t.id}: added frontmatter (status: ${t.status})`);
    for (const w of t.warnings) console.log(`    could not infer — ${w}`);
  }
  console.log(`agentviz-ticket: migrated ${migrated} ticket(s), ${skipped} skipped, ${tickets.length - migrated - skipped} already had frontmatter`);
  return 0;
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

function usage() {
  console.log([
    'agentviz-ticket: usage —',
    '  list [--status s,s] [--series N] [--grep words]',
    '  show <ID>',
    '  start <ID> [--branch] [--force]',
    '  new --title T --series S --why W [--checked A,B] [--depends A,B] [--related A,B]',
    '  split <PARENT> --title T --why W [--checked A,B]',
    '  status <ID> <planned|ready|in progress|blocked|done> [--evidence E] [--reason R] [--reopen]',
    '  amend <ID> "text" | note <ID> "text" | index | migrate',
    '  execution <ID> --mode <direct|tool|skill|subagent|parallel-subagents|team>',
    '            --delegation <none|investigator|implementer|debugger|architect|verifier|security|mixed>',
    '            --reason "..."',
    '  (any) [--as user|ai]',
  ].join('\n'));
}

async function run(argv) {
  const [cmd, ...rest] = argv;
  const { opts, pos } = parseArgv(rest);
  if (!cmd || opts.help === true) { usage(); return cmd ? 0 : 2; }
  const actor = resolveActor(opts);
  switch (cmd) {
    case 'list': return cmdList(pos, opts);
    case 'show': return cmdShow(pos);
    case 'start': return await cmdStart(pos, opts, actor);
    case 'new': return await cmdNew(pos, opts, actor);
    case 'split': return await cmdSplit(pos, opts, actor);
    case 'status': return await cmdStatus(pos, opts, actor);
    case 'amend': return await cmdAmend(pos, opts, actor);
    case 'note': return await cmdNote(pos, opts, actor);
    case 'execution': return await cmdExecution(pos, opts, actor);
    case 'index': return cmdIndex();
    case 'migrate': return cmdMigrate();
    default:
      usage();
      throw new Usage(`unknown command "${cmd}"`);
  }
}

run(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    const code = err instanceof Refusal || err instanceof Usage ? err.exitCode : 2;
    console.error(`agentviz-ticket: ${err?.message ?? String(err)}`);
    for (const line of err?.detail ?? []) console.error(line);
    process.exit(code);
  });
