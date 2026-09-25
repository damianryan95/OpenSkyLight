import fs from "node:fs";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input = {};
try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); }

const sessionId = input.session_id;
if (!sessionId) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateFile = path.join(projectDir, ".claude", "team", "active", `${sessionId}.json`);

try {
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
} catch {
  // Never make session shutdown fail because best-effort cleanup could not run.
}

process.exit(0);
