import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const context = process.env.OSL_DEPLOY_CONTEXT ?? 'openskylight-home'
const host = process.env.OSL_DEPLOY_HOST ?? '192.168.200.32'
const listenAddress = process.env.OSL_LISTEN_ADDRESS ?? host
const healthUrl = process.env.OSL_DEPLOY_HEALTH_URL ?? `http://${host}:3000/health/ready`
const project = process.env.OSL_COMPOSE_PROJECT ?? 'openskylight'
const imageTag = process.env.OSL_IMAGE_TAG ?? `dev-${new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14)}`
const composeArgs = ['--context', context, 'compose', '--project-name', project, '-f', 'compose.yaml']
const docker = (args, options = {}) => execFileSync('docker', args, { stdio: 'inherit', ...options })
const npm = (args) => execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit' })

function assertContext() {
  try {
    execFileSync('docker', ['context', 'inspect', context], { stdio: 'ignore' })
  } catch {
    console.error(`Docker context '${context}' was not found.`)
    console.error(`Create it with: docker context create ${context} --docker host=ssh://osl-deploy@${host}`)
    process.exit(1)
  }
}

async function waitForHealth() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(healthUrl)
      if (response.ok) return
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`OpenSkyLight did not become ready at ${healthUrl}`)
}

assertContext()
console.log('Running local release checks...')
npm(['run', 'typecheck'])
npm(['test'])
npm(['run', 'build'])

const backupsDir = join(process.cwd(), 'backups')
mkdirSync(backupsDir, { recursive: true })
const image = `openskylight:${imageTag}`
const imageArchive = join(tmpdir(), `openskylight-${imageTag}.tar`)
console.log(`Building ${image} locally...`)
docker(['build', '--build-arg', `OSL_VERSION=${imageTag}`, '--tag', image, '.'])
console.log('Transferring the image to the Docker VM...')
docker(['save', '--output', imageArchive, image])
try {
  docker(['--context', context, 'load', '--input', imageArchive])
} finally {
  unlinkSync(imageArchive)
}

const containerId = execFileSync('docker', [
  '--context', context,
  'ps', '--filter', `label=com.docker.compose.project=${project}`, '--quiet', '--latest',
], { encoding: 'utf8' }).trim()

if (containerId) {
  const backupName = `openskylight-pre-${imageTag}.db`
  const remoteBackup = `/tmp/${backupName}`
  const localBackup = join(backupsDir, backupName)
  console.log(`Backing up the existing database to ${localBackup}...`)
  docker(['--context', context, 'exec', containerId, 'node', 'out/server/operations-cli.js', 'backup', '/data/openskylight.db', remoteBackup])
  docker(['--context', context, 'cp', `${containerId}:${remoteBackup}`, localBackup])
  docker(['--context', context, 'exec', containerId, 'rm', '-f', remoteBackup])
}

console.log(`Deploying image tag ${imageTag} to ${host}...`)
docker([...composeArgs, 'up', '--detach', '--no-build', '--remove-orphans'], {
  env: { ...process.env, OSL_IMAGE_TAG: imageTag, OSL_LISTEN_ADDRESS: listenAddress },
})

console.log(`Waiting for ${healthUrl}...`)
await waitForHealth()
console.log(`OpenSkyLight is healthy at http://${host}:3000`)
