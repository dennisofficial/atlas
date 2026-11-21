import { afterEach, describe, expect, it } from 'bun:test'

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonTestEnv, spawnDaemon } from '../testing'

const ENTRY = join(import.meta.dir, '../index.ts')
const VERSION = 'a'.repeat(64)

type Booted = {
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  port: number
  token: string
  home: string
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const boot = async (): Promise<Booted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-daemon-version-'))
  const env: Record<string, string | undefined> = {
    ...daemonTestEnv(home),
    ATLAS_DAEMON_BUNDLE_VERSION: VERSION,
    ATLAS_DAEMON_RESTART_HINT: join(home, 'next-bundle-url'),
  }
  const { child, port } = await spawnDaemon({ entry: ENTRY, env })
  cleanups.push(() => {
    child.kill('SIGKILL')
    rmSync(home, { recursive: true, force: true })
  })
  return { child, port, token: env.DAEMON_TOKEN ?? '', home }
}

const postRestart = (args: { port: number; token?: string; body?: string }): Promise<Response> =>
  fetch(`http://127.0.0.1:${args.port}/restart`, {
    method: 'POST',
    headers: {
      ...(args.token === undefined ? {} : { authorization: `Bearer ${args.token}` }),
      ...(args.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(args.body === undefined ? {} : { body: args.body }),
  })

describe('daemon version and restart', () => {
  it('answers the bundle version the sandbox boot loop passed in', async () => {
    const daemon = await boot()
    const answer = await fetch(`http://127.0.0.1:${daemon.port}/version`)

    expect(answer.status).toBe(200)
    expect((await answer.text()).trim()).toBe(VERSION)
  })

  it('refuses a restart without the daemon token and keeps running', async () => {
    const daemon = await boot()

    expect((await postRestart({ port: daemon.port })).status).toBe(403)
    expect((await postRestart({ port: daemon.port, token: 'wrong' })).status).toBe(403)
    expect((await fetch(`http://127.0.0.1:${daemon.port}/version`)).status).toBe(200)
    expect(daemon.child.exitCode).toBeNull()
  })

  it('reports the daemon protocol range on /version so a host can admit a compatible daemon', async () => {
    const daemon = await boot()
    const answer = await fetch(`http://127.0.0.1:${daemon.port}/version`)

    expect(Number(answer.headers.get('x-atlas-daemon-protocol'))).toBeGreaterThan(0)
    expect(Number(answer.headers.get('x-atlas-daemon-min-protocol'))).toBeGreaterThan(0)
  })

  it('records the bundle a restart asked for, so the boot loop fetches that one', async () => {
    const daemon = await boot()

    await postRestart({
      port: daemon.port,
      token: daemon.token,
      body: JSON.stringify({ bundleUrl: 'https://api/agent/daemon/bundle?version=abc' }),
    })
    expect(await daemon.child.exited).toBe(0)

    expect(readFileSync(join(daemon.home, 'next-bundle-url'), 'utf8').trim()).toBe(
      'https://api/agent/daemon/bundle?version=abc',
    )
  })

  it('accepts an authenticated restart and exits 0 so the boot loop starts the new bundle', async () => {
    const daemon = await boot()

    const accepted = await postRestart({ port: daemon.port, token: daemon.token })
    expect(accepted.status).toBe(202)
    expect(await accepted.text()).toBe('restarting')
    expect(await daemon.child.exited).toBe(0)
  })
})
