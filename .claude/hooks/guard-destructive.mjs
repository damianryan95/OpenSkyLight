#!/usr/bin/env node
/**
 * PreToolUse guard for Bash in the OpenSkyLight repo.
 *
 * Blocks the small set of commands that destroy work in ways git cannot undo,
 * so an autonomous agent cannot take the codebase with it. Exits 2, which is a
 * blocking error: the model is told no and adapts, and the human is never
 * prompted. Everything else passes through — this is not a permission system.
 *
 * Routine deletion stays allowed deliberately: single-file `rm`, scratch and
 * /tmp cleanup, and `git rm` of a tracked file, which history can recover.
 *
 * Written in Node rather than shell+jq on purpose: jq is not installed on the
 * development machine, and a guard that silently fails open is worse than no
 * guard at all. Node is guaranteed — the project cannot build without it.
 */

/**
 * Strips spans that are text payloads rather than executed commands: commit and
 * tag messages, and heredoc bodies. Without this the guard blocks a commit that
 * merely *describes* a dangerous command, which it did on its own commit.
 * Paths are never quoted away — `rm -rf "src"` still matches.
 */
function executablePart(command) {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?^\s*\2\s*$/gm, ' ')
    .replace(/(^|\s)(-m|--message)(=|\s+)(['"])[\s\S]*?\4/g, '$1$2 MSG')
}

const RULES = [
  {
    // Untracked files are gone for good once cleaned. The worst case here.
    test: (c) => /\bgit\s+clean\b/.test(c) && /\s-[a-z]*f/.test(c),
    why: "'git clean -f' permanently deletes untracked files; git cannot recover them."
  },
  {
    test: (c) => /\bgit\s+reset\s+--hard\b/.test(c),
    why: "'git reset --hard' discards uncommitted work."
  },
  {
    test: (c) => {
      if (/\bgit\s+checkout\b[^|;&]*\s(--\s+)?\.(\s|$)/.test(c)) return true
      const restore = /\bgit\s+restore\b([^|;&]*)/.exec(c)
      if (restore === null) return false
      const args = restore[1]
      if (!/\s(--\s+)?\.(\s|$)/.test(args)) return false
      // `--staged` on its own only unstages; the working copy is untouched.
      return !(/--staged/.test(args) && !/--worktree/.test(args))
    },
    why: 'Discarding the whole working tree throws away uncommitted work.'
  },
  {
    test: (c) => /\bgit\s+push\b/.test(c) && /(--force(?!-with-lease)|\s-f(\s|$))/.test(c),
    why: 'Force-pushing rewrites published history.'
  },
  {
    // Recursive removal of anything that is not obviously scratch.
    test: (c) => {
      const rm = /\brm\b[^|;&]*/g
      for (const [segment] of [...c.matchAll(rm)].map((m) => [m[0]])) {
        if (!/\s-[a-zA-Z]*r/i.test(segment)) continue
        if (/\/tmp\/|[Tt]emp[\/\\]|scratch/.test(segment)) continue
        if (/\s(\/|~)(\s|$|\/)/.test(segment)) return true
        if (/\s[^\s]*\*/.test(segment)) return true
        // A leading dot is not a word boundary, so \b would miss .git entirely.
        if (/(^|[\s/"'])(src|docs|tests|deployment|scripts|node_modules|\.git|\.claude)([\s/"']|$)/.test(segment)) return true
      }
      return false
    },
    why: 'Recursive delete targeting repository content, a root path, or a glob.'
  }
]

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  let command = ''
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? ''
  } catch {
    // Malformed input is a harness problem, not an attack. Do not wedge the session.
    process.exit(0)
  }
  if (typeof command !== 'string' || command.length === 0) process.exit(0)

  const hit = RULES.find((rule) => rule.test(executablePart(command)))
  if (hit === undefined) process.exit(0)

  process.stderr.write(
    `Blocked by .claude/hooks/guard-destructive.mjs: ${hit.why}\n` +
    'If this is genuinely required, stop and ask the human to run it.\n'
  )
  process.exit(2)
})
