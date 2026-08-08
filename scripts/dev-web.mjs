import { spawn } from 'node:child_process'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [['run', 'dev:server'], ['run', 'dev:kiosk'], ['run', 'dev:companion']].map((args) => spawn(npm, args, { stdio: 'inherit' }))
const stop = () => children.forEach((child) => child.kill('SIGTERM'))
process.once('SIGINT', stop); process.once('SIGTERM', stop)
for (const child of children) child.once('exit', (code) => { if (code && code !== 0) { stop(); process.exitCode = code } })
