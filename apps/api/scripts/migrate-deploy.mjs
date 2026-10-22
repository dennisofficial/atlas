import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DB_PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db')

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
      log(
        `prisma db migrate exited ${exitCode} (attempt ${attempt}/${attempts}); retrying in ${backoffMs / 1000}s`,
      )
      await sleep(backoffMs)
    }
  }
  return 1
}

function runPrismaDbMigrate() {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', '--bun', 'prisma', 'db', 'migrate', '--to', 'db'], {
      cwd: DB_PACKAGE,
      stdio: 'inherit',
    })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  process.exitCode = await migrateDeployWithRetry({
    run: runPrismaDbMigrate,
    sleep,
    log: console.error,
  })
}
