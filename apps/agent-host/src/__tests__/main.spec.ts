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
})
