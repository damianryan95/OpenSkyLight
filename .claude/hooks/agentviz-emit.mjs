#!/usr/bin/env node
/**
 * agentviz-emit.mjs — Claude Code hook → Agentic Development Visualiser.
 *
 * Wired in .claude/settings.json for every lifecycle hook. Claude Code pipes the
 * hook payload as JSON on stdin (common fields: session_id, transcript_path, cwd,
 * hook_event_name, permission_mode, prompt_id; plus event-specific fields such as
 * tool_name / tool_input / agent_id). We build a compact, ALREADY-REDACTED
 * envelope and hand it to the collector; when the collector is down it is spooled.
 *
 * Contract with Claude Code:
 *  - always exit 0 (exit 2 would block the action — never do that here)
 *  - never print to stdout (stdout of a hook can be interpreted by Claude Code)
 *  - be fast (< 100 ms after node start is the target)
 *
 * Optional argv[2] overrides the hook name for settings entries where
 * hook_event_name might be absent.
 *
 * Zero dependencies. Node >= 20. Works on Windows/macOS/Linux.
 */
import {
  MAX_PROMPT, MAX_PREVIEW, MAX_STRING,
  baseEnvelope, isDisabled, preview, readStdin, redactSecrets, sanitise, send, truncate,
} from './agentviz-transport.mjs';

/** Common fields already lifted to the envelope header — not repeated in `fields`. */
const HEADER_KEYS = new Set(['session_id', 'cwd', 'hook_event_name', 'permission_mode', 'agent_id', 'agent_type', 'tool_name', 'tool_use_id', 'prompt_id', 'transcript_path']);

/** Fields copied as-is (after generic sanitisation) into `fields`. */
const PASSTHROUGH = new Set([
  'reason', 'model', 'stop_reason', 'error_type', 'notification_type',
  'task_id', 'task_description', 'worktree_path', 'repo_path', 'from_model', 'to_model',
  'team_name', 'trigger', 'source', 'matcher', 'error',
]);

/** Fields that hold free text / bodies → short redacted preview only. */
const PREVIEW_FIELDS = new Set([
  'tool_output', 'tool_response', 'last_assistant_message', 'error_message', 'message',
]);

const TASK_NOTIFICATION_RE = /<task-notification>[\s\S]*?<\/task-notification>/i;
const TASK_SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;
const PASTED_CONTENT_RE = /<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/gi;

/**
 * The first line of a real prompt is a fine objective label. A background
 * task notification or a pasted block is not: its first line is just an
 * opening tag, so without this it shows up verbatim as "the objective" (e.g.
 * `<task-notification>`) with nothing recognisable behind it. Recover a
 * human-readable label instead of the raw wrapper.
 */
export function extractPromptLine(raw) {
  const text = raw.replace(/^\s*\n+/, '');

  const notification = text.match(TASK_NOTIFICATION_RE);
  if (notification) {
    const label = notification[0].match(TASK_SUMMARY_RE)?.[1].trim().replace(/\s+/g, ' ') || 'a background task finished';
    return { first: `Background task: ${label}`, truncatedExtra: true };
  }

  const stripped = text.replace(PASTED_CONTENT_RE, ' ');
  if (stripped !== text) {
    const collapsed = stripped.replace(/\s+/g, ' ').trim();
    return { first: collapsed || 'Pasted content', truncatedExtra: true };
  }

  const nl = text.indexOf('\n');
  const first = (nl === -1 ? text : text.slice(0, nl)).trim();
  return { first, truncatedExtra: nl !== -1 };
}

export function buildFields(input) {
  const fields = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || HEADER_KEYS.has(key)) continue;
    if (key === 'prompt') {
      const mode = process.env.AGENTVIZ_RECORD_PROMPTS || 'first-line';
      if (mode === 'none') continue;
      const { first, truncatedExtra } = extractPromptLine(String(value));
      fields.prompt = truncate(redactSecrets(first), MAX_PROMPT);
      fields.prompt_truncated = truncatedExtra || first.length > MAX_PROMPT;
      continue;
    }
    if (PREVIEW_FIELDS.has(key)) { fields[key] = preview(value, MAX_PREVIEW); continue; }
    if (key === 'tool_input') { fields.tool_input = sanitise(value, 4, MAX_STRING, 20); continue; }
    if (PASSTHROUGH.has(key)) { fields[key] = sanitise(value, 2, MAX_STRING, 20); continue; }
    // Anything else: keep scalars only (sanitised); skip large/unknown objects
    // like transcript_path which we deliberately do not consume.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[key] = typeof value === 'string' ? truncate(redactSecrets(value), MAX_STRING) : value;
    }
  }
  return fields;
}

async function main() {
  if (isDisabled()) return;
  const raw = await readStdin();
  if (!raw) return;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (!input || typeof input !== 'object') return;

  const hook = process.argv[2] || input.hook_event_name;
  if (!hook) return;

  const envelope = baseEnvelope(hook, input.session_id || process.env.CLAUDE_CODE_SESSION_ID, {
    cwd: typeof input.cwd === 'string' ? input.cwd : process.cwd(),
    permission_mode: input.permission_mode,
    agent_id: input.agent_id,
    agent_type: input.agent_type,
    tool_name: input.tool_name,
    tool_use_id: input.tool_use_id,
    prompt_id: input.prompt_id,
    fields: buildFields(input),
  });
  // Drop undefined keys so the wire payload stays compact.
  for (const k of Object.keys(envelope)) if (envelope[k] === undefined) delete envelope[k];

  await send(envelope);
}

main().catch(() => {}).finally(() => process.exit(0));
