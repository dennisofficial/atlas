import type { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'

import {
  createSystemCloudflaredHost,
  ensureCloudflared,
  MISSING_BINARY_MESSAGE,
  type CloudflaredHost,
} from '../cloudflared'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const spawned: {
  command: string
  args: string[]
  env: Record<string, string | undefined>
}[] = []
const writes: { path: string; data: string }[] = []
const spawnFn = ((
  command: string,
  args: string[],
  options: { env: Record<string, string | undefined> },
) => {
  spawned.push({ command, args, env: options.env })
  return { unref: () => undefined }
}) as unknown as typeof spawn

const hostWith = (over: Partial<CloudflaredHost> & { logAfterLaunch?: string }) => {
  let clock = 0
  let log = ''
  const launches: string[] = []
  const stops: string[] = []
  const host: CloudflaredHost = {
    binaryExists: () => true,
    isRunning: () => false,
    storedTokenHash: () => undefined,
    stopRunning: async () => {
      stops.push('stop')
    },
    launch: ({ token }) => {
      launches.push(token)
      log += over.logAfterLaunch ?? ''
    },
    readLog: () => log,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    ...over,
  }
  return { host, launches, stops }
}

describe('ensureCloudflared', () => {
  it('refuses naming the missing binary without launching', async () => {
    const { host, launches } = hostWith({ binaryExists: () => false })

    await expect(ensureCloudflared({ token: 't', host })).rejects.toThrow(MISSING_BINARY_MESSAGE)
    expect(launches).toEqual([])
  })

  it('skips the launch when a connector is already running', async () => {
    const { host, launches } = hostWith({
      isRunning: () => true,
      storedTokenHash: () => sha256('t'),
    })

    await ensureCloudflared({ token: 't', host })

    expect(launches).toEqual([])
  })

  it('launches with the token and resolves once the tunnel registers', async () => {
    const { host, launches } = hostWith({
      logAfterLaunch: 'INF Registered tunnel connection\n',
    })

    await ensureCloudflared({ token: 'secret', host })

    expect(launches).toEqual(['secret'])
  })

  it('throws with the log tail when no connection registers in time', async () => {
    const { host } = hostWith({ logAfterLaunch: 'ERR failed to dial 7844\n' })

    await expect(ensureCloudflared({ token: 't', host })).rejects.toThrow('failed to dial 7844')
  })

  it('kills a running connector whose token differs and relaunches', async () => {
    const { host, launches, stops } = hostWith({
      isRunning: () => true,
      storedTokenHash: () => sha256('old'),
      logAfterLaunch: 'INF Registered tunnel connection\n',
    })

    await ensureCloudflared({ token: 'new', host })

    expect(stops).toEqual(['stop'])
    expect(launches).toEqual(['new'])
  })

  it('succeeds without waiting when a concurrent expose started the connector', async () => {
    let started = false
    let polls = 0
    let clock = 0
    const { host } = hostWith({
      now: () => clock,
      sleep: async (ms) => {
        polls += 1
        clock += ms
      },
      isRunning: () => started,
      storedTokenHash: () => (started ? sha256('t') : undefined),
      launch: () => {
        started = true
      },
    })
    await ensureCloudflared({ token: 't', host })

    expect(polls).toBeLessThanOrEqual(1)
  })
})

describe('systemCloudflaredHost.launch', () => {
  it('keeps the token out of argv and every other secret out of the env', () => {
    const host = createSystemCloudflaredHost({
      spawnFn,
      writeFile: (path, data) => writes.push({ path, data }),
    })
    process.env.ATLAS_SERVE_TOKEN = 'serve-secret'

    host.launch({ token: 'tunnel-secret' })

    const call = spawned.at(-1)
    expect(call?.args.join(' ')).not.toContain('tunnel-secret')
    expect(call?.args.join(' ')).not.toContain('--token')
    expect(writes.at(-1)).toEqual({
      path: '/opt/atlas/cloudflared.token-sha256',
      data: sha256('tunnel-secret'),
    })
    expect(call?.env.TUNNEL_TOKEN).toBe('tunnel-secret')
    expect(call?.env.ATLAS_SERVE_TOKEN).toBeUndefined()
    expect(Object.keys(call?.env ?? {}).sort()).toEqual(['HOME', 'PATH', 'TUNNEL_TOKEN'])
  })
})
