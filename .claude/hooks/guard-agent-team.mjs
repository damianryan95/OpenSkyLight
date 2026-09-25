import fs from "node:fs";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw || "{}");
} catch {
  console.error("Agent Team guard could not parse hook input.");
  process.exit(2);
}

if (input.tool_name !== "Agent") process.exit(0);

const ti = input.tool_input || {};

// No generic fallback agents in this operating model. Route explicitly to
// Curator, Explore, or one of the project specialists.
const subagentType = ti.subagent_type || ti.subagentType || "";
if (subagentType === "general-purpose" || subagentType === "claude") {
  console.error(
    `Generic subagent '${subagentType}' is disabled. Route to implementer or another specialist, use Explore for cheap read-only discovery, or keep the work with the Curator.`
  );
  process.exit(2);
}

// Unnamed Agent calls remain ordinary explicit specialist subagent delegation.
if (!ti.name) process.exit(0);

// Claude Code documents fork/isolation calls as exceptions to named-teammate creation.
if (ti.fork === true || ti.isolation) process.exit(0);

const sessionId = input.session_id;
if (!sessionId) {
  console.error("Named teammate blocked: hook input has no session_id.");
  process.exit(2);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateFile = path.join(projectDir, ".claude", "team", "active", `${sessionId}.json`);

if (!fs.existsSync(stateFile)) {
  console.error([
    "Named teammate blocked because the Team Gate is inactive for this session.",
    "Use an unnamed/forked/isolated subagent for ordinary delegation.",
    "If the Team Gate genuinely passes, activate it first:",
    'node .claude/hooks/team-control.mjs start "<objective>"'
  ].join("\n"));
  process.exit(2);
}

try {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (state.active !== true || state.sessionId !== sessionId) throw new Error("invalid state");
} catch {
  console.error("Named teammate blocked: Team Gate state is invalid for this session.");
  process.exit(2);
}

process.exit(0);
