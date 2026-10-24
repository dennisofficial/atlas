import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

const API_ROOT = import.meta.dirname + '/..'
const BOOT_TIMEOUT_MS = 60_000

function probeEnv({ port }: { port: number }): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_TIER: 'local',
    PORT: String(port),
    DATABASE_URL: 'postgresql://atlas:atlas@127.0.0.1:1/atlas',
    SECRET_KEY: 'test-secret-key-with-at-least-32-characters',
    WEB_ORIGIN: 'http://localhost:3001',
    BETTER_AUTH_URL: `http://localhost:${port}`,
    SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    TRIGGER_SECRET_KEY: 'tr_dev_test-fixture-not-a-real-key',
    GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    RESEND_API_KEY: 're_test_fixture_not_a_real_key',
    NODE_ENV: 'development',
    DOTENV_PRIVATE_KEY_API_LOCAL: undefined,
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

describe('api under the bun runtime', () => {
  let child: ChildProcess
  let port: number
  let base: string
  let output = ''

  beforeAll(async () => {
    port = await freePort()
    base = `http://127.0.0.1:${port}`
    child = spawn('bun', ['src/main.ts'], { cwd: API_ROOT, env: probeEnv({ port }) })
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    await waitForHealth({ base }).catch((failure: unknown) => {
      throw new Error(`${String(failure)}\n${output}`)
    })
  }, BOOT_TIMEOUT_MS + 5_000)

  afterAll(() => {
    child.kill('SIGKILL')
  })

  it('answers health', async () => {
    const response = await fetch(`${base}/v1/health`)
    expect(response.status).toBe(200)
  })

  it('injects the session verifier into SessionAuthGuard', async () => {
    const response = await fetch(`${base}/v1/secrets`)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ message: 'a valid session is required' })
  })

  it('injects the session verifier into SessionOrSandboxGuard', async () => {
    const response = await fetch(`${base}/v1/threads/recent`)
    expect(response.status).toBe(401)
  })

  it('answers 401 on a tRPC procedure without a sandbox token', async () => {
    const response = await fetch(`${base}/v1/trpc/sandboxSelf.events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    })
    expect(response.status).toBe(401)
  })

  it('refuses a tRPC body over the 4mb global cap with 413', async () => {
    const response = await fetch(`${base}/v1/trpc/sandboxSelf.stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x'.repeat(5 * 1024 * 1024) }),
    })
    expect(response.status).toBe(413)
  })

  it(
    'injects the session verifier and wake boot adapter by constructor token',
    () => {
      const probe = spawnSync('bun', ['test/fixtures/bun-di-probe.ts'], {
        cwd: API_ROOT,
        env: probeEnv({ port }),
        encoding: 'utf8',
        timeout: BOOT_TIMEOUT_MS,
      })
      expect(probe.status, probe.stderr).toBe(0)
      expect(JSON.parse(probe.stdout.trim().split('\n').pop() ?? '{}')).toEqual({
        sessionAuthVerifier: true,
        wakeBootAdapter: true,
      })
    },
    BOOT_TIMEOUT_MS + 5_000,
  )
})
