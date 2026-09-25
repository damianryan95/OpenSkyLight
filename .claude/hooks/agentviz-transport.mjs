/**
 * agentviz-transport.mjs — shared, dependency-free transport for the
 * Agentic Development Visualiser hooks (Node >= 20, cross-platform).
 *
 * Responsibilities
 *  - sanitise envelopes BEFORE they leave the hook process (mirrors
 *    packages/shared/src/redact.ts — keep both in sync, see docs/INTEGRATION.md)
 *  - POST to the local collector with a short timeout
 *  - fall back to an append-only spool file when the collector is down
 *
 * Nothing here ever throws to the caller and nothing is written to stdout.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENVELOPE_VERSION = 1;
export const MAX_STDIN_BYTES = 2 * 1024 * 1024;
export const MAX_STRING = 600;
export const MAX_PREVIEW = 300;
export const MAX_PROMPT = 240;
const FETCH_TIMEOUT_MS = 700;

// ---------------------------------------------------------------------------
// Redaction — mirrors packages/shared/src/redact.ts (SECRET_PATTERNS + ENV_ASSIGNMENT)
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk|rk|pk)[-_](live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(?<=\b(?:Bearer|Basic|Token)\s)[A-Za-z0-9._~+/=-]{16,}/gi,
  /(?<=\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth)\s*[=:]\s*)(["']?)[^\s"'&;]{6,}\1/gi,
  /(?<=:\/\/[^\s/:@]+:)[^\s@/]+(?=@)/g,
];
const ENV_ASSIGNMENT = /\b(export\s+)?([A-Z][A-Z0-9_]{2,})=("[^"]*"|'[^']*'|[^\s;&|]+)/g;
const DROP_KEYS = /^(env|environment|envs|secrets?|credentials?|password|passwd|token|api[_-]?key|authorization|cookie|private[_-]?key)$/i;

export function redactSecrets(input) {
  if (!input) return input;
  let out = input;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  out = out.replace(ENV_ASSIGNMENT, (_m, exp, key) => `${exp ?? ''}${key}=[REDACTED]`);
  return out;
}

export function truncate(s, max) {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…';
}

/** One-line, redacted, truncated preview. */
export function preview(v, max = MAX_PREVIEW) {
  const s = typeof v === 'string' ? v : safeStringify(v);
  return truncate(redactSecrets(s).replace(/\s+/g, ' ').trim(), max);
}

export function safeStringify(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** Deep-sanitise: drop credential-like keys, redact + truncate strings, bound arrays/depth. */
export function sanitise(v, depth = 4, maxString = MAX_STRING, maxArray = 20) {
  const walk = (x, d) => {
    if (x === null || x === undefined) return x;
    if (typeof x === 'string') return truncate(redactSecrets(x), maxString);
    if (typeof x === 'number' || typeof x === 'boolean') return x;
    if (d <= 0) return '[…]';
    if (Array.isArray(x)) return x.slice(0, maxArray).map((i) => walk(i, d - 1));
    if (typeof x === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(x)) {
        if (DROP_KEYS.test(k)) continue; // dropped entirely — never leaves the hook
        out[k] = walk(val, d - 1);
      }
      return out;
    }
    return String(x);
  };
  return walk(v, depth);
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
export function agentvizHome() {
  return process.env.AGENTVIZ_HOME || path.join(os.homedir(), '.agentviz');
}

export function collectorUrl() {
  const port = Number(process.env.AGENTVIZ_PORT) || 4317;
  return `http://127.0.0.1:${port}/ingest`;
}

export function isDisabled() {
  return process.env.AGENTVIZ_DISABLED === '1' || process.env.AGENTVIZ_DISABLED === 'true';
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
function spoolFileFor(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return path.join(agentvizHome(), 'spool', `${safe}.jsonl`);
}

/** Append one JSON line to the spool. Never throws. */
export function spool(envelope) {
  try {
    const file = spoolFileFor(envelope.session_id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(envelope) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * POST the envelope to the collector; on any failure append it to the spool.
 * Resolves to 'sent' | 'spooled' | 'dropped'. Never rejects.
 */
export async function send(envelope) {
  if (isDisabled()) return 'dropped';
  try {
    const headers = { 'content-type': 'application/json' };
    if (process.env.AGENTVIZ_TOKEN) headers['x-agentviz-token'] = process.env.AGENTVIZ_TOKEN;
    const res = await fetch(collectorUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) return 'sent';
  } catch {
    // collector down / timeout / refused → spool
  }
  return spool(envelope) ? 'spooled' : 'dropped';
}

/** Common envelope header shared by every hook script. */
export function baseEnvelope(hook, sessionId, extra = {}) {
  return {
    v: ENVELOPE_VERSION,
    receivedAt: new Date().toISOString(),
    hook,
    session_id: sessionId,
    cwd: process.cwd(),
    project_dir: process.env.CLAUDE_PROJECT_DIR,
    ...extra,
  };
}

/** Read all of stdin with a size cap. Resolves to '' on any problem. */
export function readStdin(maxBytes = MAX_STDIN_BYTES) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    if (process.stdin.isTTY) return finish('');
    process.stdin.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { finish(''); process.stdin.destroy(); return; }
      chunks.push(c);
    });
    process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => finish(''));
    // Safety net: a hook must never hang if stdin is never closed.
    setTimeout(() => finish(''), 1500).unref();
  });
}
