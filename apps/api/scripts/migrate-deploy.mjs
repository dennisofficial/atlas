import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const DEFAULT_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = 20_000

export async function migrateDeployWithRetry({
  run,
  sleep,
  log,
  attempts = DEFAULT_ATTEMPTS,
  backoffMs = DEFAULT_BACKOFF_MS,
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const exitCode = await run()
    if (exitCode === 0) return 0
    if (attempt < attempts) {
      log(`prisma migrate deploy exited ${exitCode} (attempt ${attempt}/${attempts}); retrying in ${backoffMs / 1000}s`)
      await sleep(backoffMs)
    }
  }
  return 1
}

function runPrismaMigrateDeploy() {
  return new Promise((resolve) => {
    const child = spawn('prisma', ['migrate', 'deploy'], { stdio: 'inherit' })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  process.exitCode = await migrateDeployWithRetry({ run: runPrismaMigrateDeploy, sleep, log: console.error })
}
