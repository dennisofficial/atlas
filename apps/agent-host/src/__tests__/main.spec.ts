import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

describe('main.ts smoke', () => {
  it('exits 78 with the missing vars when the env is empty', async () => {
    const spawned = Bun.spawn({
      cmd: ['bun', join(import.meta.dir, '../main.ts')],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATABASE_URL: '',
        REDIS_URL: '',
        DAEMON_SECRET: '',
        SECRETS_ENCRYPTION_KEY: '',
        ATLAS_API_ORIGIN: '',
        CLOUDFLARE_API_TOKEN: '',
        CLOUDFLARE_ACCOUNT_ID: '',
        CLOUDFLARE_ZONE_ID: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await spawned.exited
    const stderr = await new Response(spawned.stderr).text()
    expect(exitCode).toBe(78)
    expect(stderr).toContain('DATABASE_URL')
    expect(stderr).toContain('REDIS_URL')
    expect(stderr).toContain('DAEMON_SECRET')
    expect(stderr).toContain('SECRETS_ENCRYPTION_KEY')
    expect(stderr).toContain('ATLAS_API_ORIGIN')
    expect(stderr).toContain('CLOUDFLARE_API_TOKEN')
  }, 30_000)

  it('exits 78 with the bundle path when the daemon bundle is missing', async () => {
    const missing = join(import.meta.dir, 'no-such-daemon-bundle.js')
    const spawned = Bun.spawn({
      cmd: ['bun', join(import.meta.dir, '../main.ts')],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATABASE_URL: 'postgres://u:p@127.0.0.1:5433/atlas',
        DATABASE_DIRECT_URL: 'postgres://u:p@127.0.0.1:5433/atlas',
        REDIS_URL: 'redis://127.0.0.1:55442',
        DAEMON_SECRET: 'secret',
        SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
        ATLAS_API_ORIGIN: 'http://127.0.0.1:3000',
        CLOUDFLARE_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
        CLOUDFLARE_ZONE_ID: 'cf-zone',
        ATLAS_DAEMON_BUNDLE: missing,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await Promise.race([
      spawned.exited,
      new Promise<number>((resolve) =>
        setTimeout(() => {
          spawned.kill()
          resolve(-1)
        }, 10_000),
      ),
    ])
    const stderr = await new Response(spawned.stderr).text()
    expect(exitCode).toBe(78)
    expect(stderr).toContain(missing)
  }, 30_000)
})
