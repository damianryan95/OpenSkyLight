#!/usr/bin/env node
/**
 * agentviz-status.mjs — Claude Code statusLine command.
 *
 * Claude Code pipes a JSON document on stdin:
 *   { model:{id,display_name}, session_id, transcript_path, version, cwd,
 *     workspace:{current_dir,project_dir},
 *     context_window:{ total_input_tokens, total_output_tokens, context_window_size,
 *                      used_percentage, current_usage:{input_tokens, output_tokens,
 *                      cache_creation_input_tokens, cache_read_input_tokens} },
 *     cost:{ total_cost_usd, total_duration_ms, total_lines_added, total_lines_removed } }
 *
 * This is the only official channel for main-session token usage, so we forward
 * a numbers-only `StatusLine` envelope to the collector (→ CONTEXT event), throttled
 * to one send per 5 s per session via an mtime stamp file. The one-line status
 * string printed to stdout is what the user sees in the terminal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { agentvizHome, baseEnvelope, isDisabled, readStdin, send } from './agentviz-transport.mjs';

const THROTTLE_MS = 5000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function pickNumbers(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of keys) { const v = num(obj[k]); if (v !== undefined) out[k] = v; }
  return out;
}

function shouldSend(sessionId) {
  try {
    const dir = path.join(agentvizHome(), 'status');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    const stamp = path.join(dir, `${safe}.stamp`);
    try {
      if (Date.now() - fs.statSync(stamp).mtimeMs < THROTTLE_MS) return false;
    } catch { /* no stamp yet */ }
    fs.writeFileSync(stamp, '');
    return true;
  } catch {
    return true;
  }
}

function fmtPct(v) { return v === undefined ? '–' : `${Math.round(v)}%`; }
function fmtCost(v) { return v === undefined ? '–' : `$${v.toFixed(2)}`; }

async function main() {
  const raw = await readStdin();
  let input = {};
  try { input = raw ? JSON.parse(raw) : {}; } catch { input = {}; }

  const modelName = input.model?.display_name || input.model?.id || 'Claude';
  const cw = input.context_window || {};
  const cost = input.cost || {};
  const line = `[${modelName}] ctx ${fmtPct(num(cw.used_percentage))} · ${fmtCost(num(cost.total_cost_usd))} · agentviz`;
  process.stdout.write(line + '\n');

  if (isDisabled()) return;
  const sessionId = input.session_id || process.env.CLAUDE_CODE_SESSION_ID;
  if (!shouldSend(sessionId)) return;

  const envelope = baseEnvelope('StatusLine', sessionId, {
    cwd: input.workspace?.current_dir || input.cwd || process.cwd(),
    project_dir: input.workspace?.project_dir || process.env.CLAUDE_PROJECT_DIR,
    fields: {
      model: typeof input.model?.id === 'string' ? input.model.id.slice(0, 120) : undefined,
      model_display: typeof modelName === 'string' ? modelName.slice(0, 120) : undefined,
      context_window: {
        ...pickNumbers(cw, ['total_input_tokens', 'total_output_tokens', 'context_window_size', 'used_percentage']),
        current_usage: pickNumbers(cw.current_usage, ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']),
      },
      cost: pickNumbers(cost, ['total_cost_usd', 'total_duration_ms', 'total_lines_added', 'total_lines_removed']),
    },
  });
  await send(envelope);
}

main().catch(() => {}).finally(() => process.exit(0));
