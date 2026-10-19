import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freePort } from '../test/bun-api-process'
import {
  type BundleApi,
  bundleNames,
  docker,
  removeBundleResources,
  startBundleApi,
  startPostgres,
  waitForPostgres,
} from '../test/bundle-container'

const API_ROOT = join(import.meta.dirname, '..')
const PRISMA = join(API_ROOT, 'node_modules', '.bin', 'prisma')
const WEBHOOK_SECRET = 'bundle-spec-github-app-webhook-secret'
const SESSION_TOKEN = `bundle-spec-${randomBytes(16).toString('hex')}`
const SETUP_TIMEOUT_MS = 240_000

const describeLive = process.env.ATLAS_LIVE_DOCKER === '1' ? describe : describe.skip

function sh({ file, args, env }: { file: string; args: string[]; env?: NodeJS.ProcessEnv }): string {
  return execFileSync(file, args, {
    cwd: API_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ?? process.env,
  })
}

function minimalEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', ...extra }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function signedHookRequest({ secret }: { secret: string }): RequestInit {
  const body = JSON.stringify({ zen: 'bundle spec', hook_id: 1 })
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-hub-signature-256': `sha256=${signature}`,
    },
  }
}

describeLive('vercel bundle (built output served from a read-only container)', () => {
  const names = bundleNames()
  let outDir: string
  let isolatedDir: string
  let api: BundleApi | undefined
  const bundleOutput = (): string => api?.output() ?? ''
  const withOutput = (message: string): string => `${message}\n--- bundle output ---\n${bundleOutput()}`
  const authed = { authorization: `Bearer ${SESSION_TOKEN}` }
  const baseUrl = (): string => api?.baseUrl ?? ''

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'atlas-vercel-output-'))
    sh({
      file: 'bun',
      args: ['-e', `import { buildVercelOutput } from './build'; await buildVercelOutput({ outDir: ${JSON.stringify(outDir)} })`],
      env: minimalEnv({}),
    })

    isolatedDir = mkdtempSync(join(tmpdir(), 'atlas-vercel-isolated-'))
    const isolatedFunc = join(isolatedDir, 'index.func')
    cpSync(join(outDir, 'functions', 'index.func'), isolatedFunc, { recursive: true })
    copyFileSync(join(API_ROOT, 'test', 'serve-bundle.ts'), join(isolatedFunc, 'serve-bundle.ts'))

    const dbPort = await freePort()
    startPostgres({ names, hostPort: dbPort })
    await waitForPostgres({ container: names.postgres })

    const databaseUrl = `postgresql://atlas:atlas@127.0.0.1:${dbPort}/atlas`
    sh({
      file: PRISMA,
      args: ['migrate', 'deploy'],
      env: minimalEnv({ DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }),
    })
    const seed = `
      INSERT INTO "User" (id, name, email, "updatedAt") VALUES ('usr_bundle', 'Bundle Spec', 'bundle@spec.test', now());
      INSERT INTO "Session" (id, token, "expiresAt", "updatedAt", "userId")
        VALUES ('ses_bundle', '${SESSION_TOKEN}', now() + interval '1 day', now(), 'usr_bundle');`
    docker(['exec', names.postgres, 'psql', '-U', 'atlas', '-d', 'atlas', '-v', 'ON_ERROR_STOP=1', '-c', seed])

    api = await startBundleApi({
      names,
      functionDir: isolatedFunc,
      hostPort: await freePort(),
      extraEnv: { GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET, RATE_LIMIT_PER_MINUTE: '1000' },
    })
  }, SETUP_TIMEOUT_MS)

  afterAll(() => {
    removeBundleResources({ names })
    if (outDir) rmSync(outDir, { recursive: true, force: true })
    if (isolatedDir) rmSync(isolatedDir, { recursive: true, force: true })
  }, 60_000)

  it('writes the Build Output API config', () => {
    expect(readJson(join(outDir, 'config.json'))).toEqual({
      version: 3,
      routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/' }],
    })
    expect(readJson(join(outDir, 'functions', 'index.func', '.vc-config.json'))).toEqual({
      runtime: 'bun1.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      supportsResponseStreaming: true,
      maxDuration: 300,
      environment: { DOTENVX_ENVS_DIR: '.', APP_TIER: 'production' },
    })
  })

  it('reports health with the shipped migrations level against the migrated database', async () => {
    const response = await fetch(`${baseUrl()}/v1/health`)
    const text = await response.text()
    expect(response.status, withOutput(text)).toBe(200)
    expect(JSON.parse(text)).toMatchObject({ status: 'ok', migrations: 'level' })
  })

  it('rejects an unauthenticated guarded route with 401', async () => {
    const response = await fetch(`${baseUrl()}/v1/secrets`)
    expect(response.status, withOutput(await response.text())).toBe(401)
  })

  it('serves a guarded route to a bearer session through prisma and pg', async () => {
    const response = await fetch(`${baseUrl()}/v1/secrets`, { headers: authed })
    const text = await response.text()
    expect(response.status, withOutput(text)).toBe(200)
    expect(JSON.parse(text)).toEqual({ secrets: [] })
  })

  it('validates a DTO body with class-validator', async () => {
    const response = await fetch(`${baseUrl()}/v1/secrets/BUNDLE_PROBE`, {
      method: 'PUT',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ unexpected: true }),
    })
    const text = await response.text()
    expect(response.status, withOutput(text)).toBe(400)
    expect(text).toContain('value must be a string')
  })

  it('mounts better-auth under /api/auth', async () => {
    const response = await fetch(`${baseUrl()}/api/auth/ok`)
    expect(response.status, withOutput(await response.text())).toBe(200)
  })

  it('accepts a correctly signed github app webhook with the raw body intact', async () => {
    const response = await fetch(`${baseUrl()}/v1/github/app/hook`, signedHookRequest({ secret: WEBHOOK_SECRET }))
    const text = await response.text()
    expect(response.status, withOutput(text)).toBe(200)
    expect(JSON.parse(text)).toEqual({ received: true })
  })

  it('rejects a github app webhook signed with the wrong secret', async () => {
    const response = await fetch(`${baseUrl()}/v1/github/app/hook`, signedHookRequest({ secret: 'wrong-secret' }))
    expect(response.status, withOutput(await response.text())).toBe(401)
  })
})
