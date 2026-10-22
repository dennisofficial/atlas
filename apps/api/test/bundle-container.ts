import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const READY_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 500
const API_CONTAINER_PORT = 3000
const POSTGRES_IMAGE = 'postgres:17-alpine'
const READY_PATTERN = /bundle listening/

export type BundleNames = { network: string; postgres: string; api: string }

export type BundleApi = { baseUrl: string; output: () => string }

export function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function bundleNames(): BundleNames {
  const suffix = randomBytes(4).toString('hex')
  return {
    network: `atlas-bundle-net-${suffix}`,
    postgres: `atlas-bundle-pg-${suffix}`,
    api: `atlas-bundle-api-${suffix}`,
  }
}

export function bunImage(): string {
  const dockerfile = readFileSync(join(import.meta.dirname, '..', 'Dockerfile'), 'utf8')
  const image = /^ARG BUN_IMAGE=(\S+)$/m.exec(dockerfile)?.[1]
  if (!image) throw new Error('apps/api/Dockerfile declares no BUN_IMAGE arg')
  return image
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function containerLogs({ container }: { container: string }): string {
  const result = spawnSync('docker', ['logs', container], { encoding: 'utf8' })
  return `${result.stdout}${result.stderr}`
}

function isRunning({ container }: { container: string }): boolean {
  try {
    return docker(['inspect', '-f', '{{.State.Running}}', container]).trim() === 'true'
  } catch {
    return false
  }
}

export function startPostgres({ names, hostPort }: { names: BundleNames; hostPort: number }): void {
  docker(['network', 'create', names.network])
  docker([
    'run',
    '-d',
    '--name',
    names.postgres,
    '--network',
    names.network,
    '-e',
    'POSTGRES_USER=atlas',
    '-e',
    'POSTGRES_PASSWORD=atlas',
    '-e',
    'POSTGRES_DB=atlas',
    '-p',
    `127.0.0.1:${hostPort}:5432`,
    POSTGRES_IMAGE,
  ])
}

export async function waitForPostgres({ container }: { container: string }): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      docker(['exec', container, 'psql', '-U', 'atlas', '-d', 'atlas', '-c', 'select 1'])
      return
    } catch {
      await sleep(POLL_INTERVAL_MS)
    }
  }
  throw new Error(`postgres container ${container} never became ready`)
}

export async function startBundleApi({
  names,
  functionDir,
  hostPort,
  extraEnv,
}: {
  names: BundleNames
  functionDir: string
  hostPort: number
  extraEnv: Record<string, string>
}): Promise<BundleApi> {
  const baseUrl = `http://127.0.0.1:${hostPort}`
  const env: Record<string, string> = {
    HOME: '/var/task',
    NODE_ENV: 'test',
    PORT: String(API_CONTAINER_PORT),
    DATABASE_URL: `postgresql://atlas:atlas@${names.postgres}:5432/atlas`,
    APP_TIER: 'local',
    SECRET_KEY: 'bundle-spec-throwaway-secret-with-32-chars',
    WEB_ORIGIN: 'http://localhost:3001',
    BETTER_AUTH_URL: baseUrl,
    SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    TRIGGER_SECRET_KEY: 'tr_dev_test-fixture-not-a-real-key',
    GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    RESEND_API_KEY: 're_test_fixture_not_a_real_key',
    ...extraEnv,
  }
  docker([
    'run',
    '-d',
    '--read-only',
    '--name',
    names.api,
    '--network',
    names.network,
    '-v',
    `${functionDir}:/var/task:ro`,
    '-w',
    '/var/task',
    '-p',
    `127.0.0.1:${hostPort}:${API_CONTAINER_PORT}`,
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    bunImage(),
    'bun',
    'serve-bundle.ts',
    '/var/task/index.js',
  ])

  const output = (): string => containerLogs({ container: names.api })
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (READY_PATTERN.test(output())) return { baseUrl, output }
    if (!isRunning({ container: names.api })) {
      throw new Error(`API container exited before it was ready\n--- docker logs ---\n${output()}`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(
    `API did not log readiness within ${READY_TIMEOUT_MS}ms\n--- docker logs ---\n${output()}`,
  )
}

export function removeBundleResources({ names }: { names: BundleNames }): void {
  const removals = [
    ['rm', '-f', '-v', names.api],
    ['rm', '-f', '-v', names.postgres],
    ['network', 'rm', names.network],
  ]
  for (const args of removals) {
    try {
      docker(args)
    } catch {}
  }
}
