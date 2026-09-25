import fs from "node:fs";
import path from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const sessionId = process.env.CLAUDE_CODE_SESSION_ID;

if (!sessionId) {
  console.error("CLAUDE_CODE_SESSION_ID is unavailable; cannot safely scope Team Mode.");
  process.exit(1);
}

const activeDir = path.join(projectDir, ".claude", "team", "active");
const stateFile = path.join(activeDir, `${sessionId}.json`);
const command = process.argv[2];
const objective = process.argv.slice(3).join(" ").trim();

function start() {
  fs.mkdirSync(activeDir, { recursive: true });
  const state = {
    active: true,
    sessionId,
    owner: "curator",
    objective: objective || "Unspecified team objective",
    delegationDepth: 1,
    startedAt: new Date().toISOString()
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
  console.log(`Team Gate active for session ${sessionId}: ${state.objective}`);
}

function stop() {
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  console.log(`Team Gate closed for session ${sessionId}`);
}

function status() {
  if (!fs.existsSync(stateFile)) {
    console.log("Team Gate: inactive");
    return;
  }
  console.log(fs.readFileSync(stateFile, "utf8").trim());
}

switch (command) {
  case "start": start(); break;
  case "stop": stop(); break;
  case "status": status(); break;
  default:
    console.error('Usage: node .claude/hooks/team-control.mjs start|stop|status ["objective"]');
    process.exit(1);
}
