import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { DB_PACKAGE, migrateDeployWithRetry, runPrismaDbMigrate } from './migrate-deploy.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function runPredeploy({ migrate, verify, log }) {
  const migrated = await migrate()
  if (migrated !== 0) {
    log(`pre-deploy: the migration left off at exit ${migrated}; the deploy is aborted`)
    return 1
  }

  const verified = await verify()
  if (verified !== 0) {
    log(`pre-deploy: prisma db verify left off at exit ${verified}; the deploy is aborted`)
    return 1
  }

  log('pre-deploy: the schema matches the contract')
  return 0
}

function runPrismaDbVerify() {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', '--bun', 'prisma', 'db', 'verify', '--strict'], {
      cwd: DB_PACKAGE,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
    })
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  process.exitCode = await runPredeploy({
    migrate: () => migrateDeployWithRetry({ run: runPrismaDbMigrate, sleep, log: console.error }),
    verify: runPrismaDbVerify,
    log: console.error,
  })
}
