import { describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION, SWAP_LOCK_PATH } from '@dltech/atlas-wire'
import {
  PINNED_VERSION,
  driverWith,
  fakeSandbox,
  fakeDriveSdk,
  notFound,
  CREDENTIALS,
} from './vercel-driver-fixture'
import { VercelDriver } from '../vercel-driver'
import type { FakeSandbox } from './vercel-driver-sandbox-fixture'

const gate = () => {
  let release: (() => void) | undefined
  const entered = new Promise<void>((resolve) => {
    release = resolve
  })
  return { entered, open: () => release?.() }
}

describe('createOrResume serialization', () => {
  it('two same-name calls share one provision', async () => {
    let created = 0
    const held = gate()
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          created += 1
          await held.entered
          return sandbox
        },
      },
    })

    const first = driver.createOrResume({ name: 'atlas-thread-x', threadId: 'thread-1' })
    const second = driver.createOrResume({ name: 'atlas-thread-x', threadId: 'thread-1' })
    while (created < 1) await Promise.resolve()
    held.open()
    const [one, two] = await Promise.all([first, second])

    expect(created).toBe(1)
    expect(two.sessionId).toBe(one.sessionId)
  })

  it('different names provision in parallel', async () => {
    const created: string[] = []
    const held = gate()
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          created.push(params?.name ?? '')
          await held.entered
          return fakeSandbox()
        },
      },
    })

    const first = driver.createOrResume({ name: 'atlas-thread-a', threadId: 'thread-a' })
    const second = driver.createOrResume({ name: 'atlas-thread-b', threadId: 'thread-b' })
    // Both provisions must reach the provider's getOrCreate before either may finish.
    while (created.length < 2) await Promise.resolve()
    expect(created.sort()).toEqual(['atlas-thread-a', 'atlas-thread-b'])
    held.open()
    await Promise.all([first, second])
  })

  it('a failed provision frees the name for the next wake', async () => {
    let attempts = 0
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('provider flaked')
          return fakeSandbox()
        },
      },
    })

    await expect(
      driver.createOrResume({ name: 'atlas-thread-x', threadId: 'thread-1' }),
    ).rejects.toThrow('provider flaked')
    const retried = await driver.createOrResume({ name: 'atlas-thread-x', threadId: 'thread-1' })

    expect(attempts).toBe(2)
    expect(retried.sessionId).toBe('session-1')
  })
})

type RunParams = { cmd: string; args?: string[] }

/**
 * A sandbox whose serve actually stops when killed and whose stamp file actually flips when the
 * install script runs — the race the swap lock serializes is meaningless without both.
 */
const swapTrackingSandbox = (args: { installed: string }) => {
  let installed = args.installed
  let serveAlive = true
  let installs = 0
  const scripts: string[] = []
  const sandbox = fakeSandbox({ alive: true })
  const originalRun = sandbox.runCommand.bind(sandbox) as (params: RunParams) => Promise<unknown>
  Object.assign(sandbox, {
    runCommand: async (params: RunParams) => {
      const script = params.args?.[1] ?? params.cmd
      scripts.push(script)
      if (script.includes('atlas-serve-linux-x64')) {
        installs += 1
        installed = PINNED_VERSION
        return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      }
      if (script.includes('.version')) {
        return {
          exitCode: 0,
          stdout: async () => `${installed}\n${CHANNEL_PROTOCOL_VERSION}\n`,
          stderr: async () => '',
        }
      }
      if (script.includes('kill "$_pid"')) {
        serveAlive = false
        return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      }
      if (script.includes('flock -n')) {
        serveAlive = true
        installed = PINNED_VERSION
        return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
      }
      if (script.startsWith('kill -0')) {
        return { exitCode: serveAlive ? 0 : 1, stdout: async () => '', stderr: async () => '' }
      }
      if (script.includes('/v1/health') && script.includes('-o /dev/null')) {
        return { exitCode: serveAlive ? 0 : 1, stdout: async () => '', stderr: async () => '' }
      }
      return originalRun(params)
    },
  })
  return { sandbox: sandbox as FakeSandbox, scripts, installs: () => installs }
}

const swapDriver = (sandbox: FakeSandbox) =>
  new VercelDriver({
    credentials: CREDENTIALS,
    cloudUrl: 'https://api.example.com',
    driveSdk: fakeDriveSdk().sdk,
    image: `atlas-sandbox:${PINNED_VERSION}`,
    serveVersion: PINNED_VERSION,
    sdk: { get: async () => sandbox, getOrCreate: async () => sandbox },
  })

describe('in-sandbox swap lock ordering', () => {
  it('an unhealthy stale serve is stopped, reinstalled, and rebooted between flock acquire and release', async () => {
    const tracked = swapTrackingSandbox({ installed: '0.0.1' })

    const placed = await swapDriver(tracked.sandbox).createOrResume({
      name: 'atlas-thread-x',
      threadId: 'thread-1',
    })

    expect(placed.rotatedFrom).toBe('0.0.1')
    expect(tracked.installs()).toBe(1)
    const acquires = tracked.scripts
      .map((script, index) => ({ script, index }))
      .filter(({ script }) => script.includes('flock -w') && script.includes(SWAP_LOCK_PATH))
    const releases = tracked.scripts
      .map((script, index) => ({ script, index }))
      .filter(({ script }) => script.includes('flock -u'))
    expect(acquires.length).toBeGreaterThan(0)
    expect(releases.length).toBeGreaterThan(0)
    const firstAcquire = acquires[0]?.index ?? -1
    const lastRelease = releases.at(-1)?.index ?? -1
    expect(lastRelease).toBeGreaterThan(firstAcquire)
    const installAt = tracked.scripts.findIndex((script) =>
      script.includes('atlas-serve-linux-x64'),
    )
    const stopAt = tracked.scripts.findIndex((script) => script.includes('kill "$_pid"'))
    const bootWaitAt = tracked.scripts.findIndex((script) => script.startsWith('for i in'))
    for (const at of [installAt, stopAt, bootWaitAt]) {
      expect(at).toBeGreaterThan(firstAcquire)
      expect(at).toBeLessThan(lastRelease)
    }
    const beforeLock = tracked.scripts.slice(0, firstAcquire)
    expect(beforeLock.some((script) => script.includes('atlas-serve-linux-x64'))).toBe(false)
    expect(beforeLock.some((script) => script.includes('kill "$_pid"'))).toBe(false)
  })

  it('a serialized second wake re-reads the winner’s stamps and installs nothing', async () => {
    const tracked = swapTrackingSandbox({ installed: '0.0.1' })

    await swapDriver(tracked.sandbox).createOrResume({ name: 'atlas-thread-x', threadId: 'thread-1' })
    expect(tracked.installs()).toBe(1)

    // The follow-up wake — a second driver, as a second client process would be — finds the
    // pinned stamps on its probe and never installs again.
    const placed = await swapDriver(tracked.sandbox).createOrResume({
      name: 'atlas-thread-x',
      threadId: 'thread-1',
    })

    expect(placed.sessionId).toBe('session-1')
    expect(tracked.installs()).toBe(1)
  })
})
