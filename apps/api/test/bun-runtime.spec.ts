import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { ensureTestDatabase } from '@dltech/atlas-db/testing'

import { JSON_BODY_LIMIT } from '../src/_lib/body-limits'

const API_ROOT = import.meta.dirname + '/..'
const JSON_BODY_CAP_BYTES = Number.parseInt(JSON_BODY_LIMIT, 10) * 1024 * 1024
const BOOT_TIMEOUT_MS = 60_000
const TEST_DATABASE_URL = process.env.ATLAS_TEST_DATABASE_URL
const TEST_REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const daemonBundleStub = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-api-probe-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, '')
  return path
}

function probeEnv({ port, databaseUrl }: { port: number; databaseUrl: string }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_TIER: 'local',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    DATABASE_DIRECT_URL: databaseUrl,
    REDIS_URL: TEST_REDIS_URL,
    DAEMON_SECRET: 'test-daemon-secret',
    ATLAS_API_ORIGIN: `http://127.0.0.1:${port}`,
    ATLAS_DAEMON_BUNDLE: daemonBundleStub(),
    SECRET_KEY: 'test-secret-key-with-at-least-32-characters',
    WEB_ORIGIN: 'http://localhost:3001',
    BETTER_AUTH_URL: `http://localhost:${port}`,
    SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    TRIGGER_SECRET_KEY: 'tr_dev_test-fixture-not-a-real-key',
    TRIGGER_JOBS_SECRET_KEY: 'tr_dev_test-fixture-not-a-real-key',
    GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    RESEND_API_KEY: 're_test_fixture_not_a_real_key',
    CLOUDFLARE_API_TOKEN: 'cf-test-token',
    CLOUDFLARE_ACCOUNT_ID: 'cf-test-account',
    CLOUDFLARE_ZONE_ID: 'cf-test-zone',
    NODE_ENV: 'development',
    DOTENV_PRIVATE_KEY_LOCAL_ENC: undefined,
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForHealth({ base }: { base: string }): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const alive = await fetch(`${base}/v1/health`).then(
      (response) => response.status === 200,
      () => false,
    )
    if (alive) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('api did not answer /v1/health under bun in time')
}

const describeWithHost =
  TEST_DATABASE_URL === undefined || TEST_REDIS_URL === undefined ? describe.skip : describe

describeWithHost('api under the bun runtime', () => {
  let child: ChildProcess
  let port: number
  let base: string
  let output = ''
  let databaseUrl = ''

  beforeAll(async () => {
    await ensureTestDatabase()
    const assigned = process.env.DATABASE_URL
    if (assigned === undefined) throw new Error('DATABASE_URL is unset')
    databaseUrl = assigned
    port = await freePort()
    base = `http://127.0.0.1:${port}`
    child = spawn('bun', ['src/main.ts'], { cwd: API_ROOT, env: probeEnv({ port, databaseUrl }) })
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    await waitForHealth({ base }).catch((failure: unknown) => {
      throw new Error(`${String(failure)}\n${output}`)
    })
  }, BOOT_TIMEOUT_MS + 120_000)

  afterAll(async () => {
    child.kill('SIGKILL')
  })

  it('answers health', async () => {
    const response = await fetch(`${base}/v1/health`)
    expect(response.status).toBe(200)
  })

  it('injects the session verifier into SessionMiddleware', async () => {
    const response = await fetch(`${base}/v1/trpc/secrets.details`)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: { message: 'a valid session is required' },
    })
  })

  it('answers 401 on a session-only procedure without a session', async () => {
    const input = encodeURIComponent(JSON.stringify({ project: '/repo' }))
    const response = await fetch(`${base}/v1/trpc/threads.recent?input=${input}`)
    expect(response.status).toBe(401)
  })

  it('answers 401 on a retired sandbox procedure', async () => {
    const response = await fetch(`${base}/v1/trpc/sandboxSelf.events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    })
    expect(response.status).toBe(401)
  })

  it('refuses a tRPC body over the global JSON cap with 413', async () => {
    const response = await fetch(`${base}/v1/trpc/sandboxSelf.stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x'.repeat(JSON_BODY_CAP_BYTES) }),
    })
    expect(response.status).toBe(413)
  })

  it(
    'injects the session verifier and wake boot adapter by constructor token',
    () => {
      const probe = spawnSync('bun', ['test/fixtures/bun-di-probe.ts'], {
        cwd: API_ROOT,
        env: probeEnv({ port, databaseUrl }),
        encoding: 'utf8',
        timeout: BOOT_TIMEOUT_MS,
      })
      expect(probe.status, probe.stderr).toBe(0)
      expect(JSON.parse(probe.stdout.trim().split('\n').pop() ?? '{}')).toEqual({
        sessionMiddlewareVerifier: true,
        wakeBootAdapter: true,
      })
    },
    BOOT_TIMEOUT_MS + 5_000,
  )
})
