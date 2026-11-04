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
        AGENT_HOST_TOKEN: '',
        DAEMON_SECRET: '',
        ATLAS_API_ORIGIN: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await spawned.exited
    const stderr = await new Response(spawned.stderr).text()
    expect(exitCode).toBe(78)
    expect(stderr).toContain('DATABASE_URL')
    expect(stderr).toContain('REDIS_URL')
    expect(stderr).toContain('AGENT_HOST_TOKEN')
    expect(stderr).toContain('DAEMON_SECRET')
    expect(stderr).toContain('ATLAS_API_ORIGIN')
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
        AGENT_HOST_TOKEN: 'token',
        DAEMON_SECRET: 'secret',
        ATLAS_API_ORIGIN: 'http://127.0.0.1:3000',
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
