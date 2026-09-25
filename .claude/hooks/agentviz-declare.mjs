#!/usr/bin/env node
/**
 * agentviz-declare.mjs — declare OBSERVABLE decisions to the visualiser.
 *
 * The Curator (or an agent) runs this via Bash to record a gate outcome, a
 * status transition, a decision or a peer-event. Only the concise declared
 * rationale is recorded — never reasoning transcripts.
 *
 * Usage
 *   gate <delegation|team|security|verification|custom> <pass|fail|pending|skipped>
 *        [--chosen direct|deterministic|skill|specialist|parallel|team] [--target <agentName>] "<rationale>"
 *   status <analysing|implementing|delegating|coordinating|integrating|verifying|waiting|complete|failed> ["active task"]
 *   activity "<what I am doing right now>" [--action edit|read|search|test|…] [--tool Edit] [--file path]
 *   decision "<summary>" ["rationale"]
 *   event <FINDING|CONTRACT_CHANGE|BLOCKER|HANDOFF|COMPLETE|FAILURE|VERIFY> [--to <agent|curator>] [--artifact path] "<summary>"
 *
 * Prints one confirmation line. Always exits 0 (a visualiser outage must never
 * block development work).
 */
import { baseEnvelope, isDisabled, preview, send } from './agentviz-transport.mjs';

const GATE_KINDS = ['delegation', 'team', 'security', 'verification', 'custom'];
const GATE_RESULTS = ['pass', 'fail', 'pending', 'skipped'];
const CHOSEN = ['direct', 'deterministic', 'skill', 'specialist', 'parallel', 'team'];
const STATUSES = ['analysing', 'implementing', 'delegating', 'coordinating', 'integrating', 'verifying', 'waiting', 'complete', 'failed'];
const EVENTS = ['FINDING', 'CONTRACT_CHANGE', 'BLOCKER', 'HANDOFF', 'COMPLETE', 'FAILURE', 'VERIFY'];

function usage(msg) {
  if (msg) console.log(`agentviz: ${msg}`);
  console.log('agentviz: usage — gate <kind> <result> [--chosen m] [--target a] "rationale" | status <s> ["task"] | activity "label" [--action a] [--tool t] [--file f] | decision "summary" ["rationale"] | event <TYPE> [--to a] [--artifact p] "summary"');
}

/** Split argv into named options (--k v) and positionals. */
function parse(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && i + 1 < argv.length) { opts[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) { opts[a.slice(2)] = true; }
    else pos.push(a);
  }
  return { opts, pos };
}

function build(argv) {
  const [cmd, ...rest] = argv;
  const { opts, pos } = parse(rest);
  switch (cmd) {
    case 'gate': {
      const kind = String(pos[0] || '').toLowerCase();
      const result = String(pos[1] || '').toLowerCase();
      if (!GATE_KINDS.includes(kind)) return { error: `unknown gate kind "${pos[0]}"` };
      if (!GATE_RESULTS.includes(result)) return { error: `unknown gate result "${pos[1]}"` };
      const chosen = opts.chosen ? String(opts.chosen).toLowerCase() : undefined;
      if (chosen && !CHOSEN.includes(chosen)) return { error: `unknown --chosen "${opts.chosen}"` };
      return {
        fields: { kind: 'gate', gateKind: kind.toUpperCase(), result: result.toUpperCase(), chosen, target: opts.target, rationale: preview(pos.slice(2).join(' '), 300) || undefined },
        confirm: `${kind.toUpperCase()} gate ${result.toUpperCase()}${chosen ? ` (${chosen})` : ''}`,
      };
    }
    case 'status': {
      const status = String(pos[0] || '').toLowerCase();
      if (!STATUSES.includes(status)) return { error: `unknown status "${pos[0]}"` };
      return {
        fields: { kind: 'status', status, activeTask: preview(pos.slice(1).join(' '), 200) || undefined },
        confirm: `status ${status}`,
      };
    }
    // Live work only. The run's assignment is fixed at start and is never
    // touched from here — that separation is the point of the event.
    case 'activity': {
      const label = preview(pos.join(' '), 200);
      if (!label) return { error: 'activity needs a label' };
      return {
        fields: {
          kind: 'activity',
          label,
          action: opts.action ? String(opts.action).toLowerCase() : undefined,
          tool: opts.tool ? String(opts.tool) : undefined,
          file: opts.file ? preview(opts.file, 200) : undefined,
        },
        confirm: `activity: ${label}`,
      };
    }
    case 'decision': {
      const summary = preview(pos[0] || '', 200);
      if (!summary) return { error: 'decision needs a summary' };
      return {
        fields: { kind: 'decision', summary, rationale: preview(pos.slice(1).join(' '), 300) || undefined, chosen: opts.chosen },
        confirm: `decision recorded`,
      };
    }
    case 'event': {
      const type = String(pos[0] || '').toUpperCase();
      if (!EVENTS.includes(type)) return { error: `unknown event type "${pos[0]}"` };
      const summary = preview(pos.slice(1).join(' '), 240);
      if (!summary) return { error: `${type} needs a summary` };
      return {
        fields: { kind: 'event', eventType: type, to: opts.to, artifact: opts.artifact, summary },
        confirm: `${type} declared`,
      };
    }
    default:
      return { error: cmd ? `unknown command "${cmd}"` : undefined };
  }
}

async function main() {
  const built = build(process.argv.slice(2));
  if (!built.fields) { usage(built.error); return; }
  if (isDisabled()) { console.log(`agentviz: ${built.confirm} (disabled)`); return; }
  const envelope = baseEnvelope('Declare', process.env.CLAUDE_CODE_SESSION_ID, {
    agent_id: process.env.CLAUDE_CODE_AGENT_ID,
    fields: Object.fromEntries(Object.entries(built.fields).filter(([, v]) => v !== undefined)),
  });
  const outcome = await send(envelope);
  console.log(`agentviz: ${built.confirm}${outcome === 'sent' ? '' : ` (${outcome})`}`);
}

main().catch(() => {}).finally(() => process.exit(0));
