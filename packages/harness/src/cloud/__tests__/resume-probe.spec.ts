import { describe, expect, it } from 'bun:test'

import { APIError, type Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire'
import {
  SERVE_PROTOCOL_PATH,
  SERVE_VERSION_PATH,
  asVercelFailure,
  isSandboxMissing,
} from '@dltech/atlas-wire'
import { ESandboxProbe, probeSandboxForResume, type ServeRuntimeHealth } from '../resume-probe'
import { PINNED, STALE, FULL_IDLE, fakeSandbox, probeOf } from './resume-probe-fixture'

describe('probeSandboxForResume', () => {
  it('answers missing when Vercel has never heard of the sandbox', async () => {
    const result = await probeSandboxForResume({
      name: 'atlas-thread-x',
      pinned: PINNED,
      timeoutMs: 5_000,
      servePort: 3000,
      fetch: async () => {
        throw new APIError(new Response(null, { status: 404 }), { message: 'sandbox not found' })
      },
      runtimeHealth: async () => undefined,
      isMissing: isSandboxMissing,
      toFailure: asVercelFailure,
    })

    expect(result.probe).toBe(ESandboxProbe.Missing)
  })

  it('keeps a sandbox whose baked serve matches the pin', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })

    const result = await probeOf({ sandbox })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(sandbox.deleted()).toBe(false)
  })

  it('replaces a confirmed stopped sandbox without commands that would auto-wake it', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    let commands = 0
    Object.assign(sandbox, {
      runCommand: async () => {
        commands += 1
        throw new Error('runCommand would resume the stopped sandbox')
      },
    })
    let waits = 0

    const result = await probeOf({
      sandbox,
      health: FULL_IDLE,
      waitForDriveDetached: async () => {
        waits += 1
        return true
      },
    })

    expect(sandbox.deleted()).toBe(true)
    expect(commands).toBe(0)
    expect(waits).toBe(1)
    expect(result.probe).toBe(ESandboxProbe.Replaced)
  })

  it('still replaces when the detach lag outlives the wait, logging the pending lag', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    const lines: string[] = []

    const result = await probeOf({
      sandbox,
      health: FULL_IDLE,
      waitForDriveDetached: async () => false,
      lines,
    })

    expect(result.probe).toBe(ESandboxProbe.Replaced)
    expect(lines.some((line) => line.includes('drive is still attached'))).toBe(true)
  })

  it('still replaces when Vercel reports the stopped sandbox gone at delete time', async () => {
    const sandbox = fakeSandbox({
      installed: STALE,
      status: 'stopped',
      deleteFailure: new APIError(new Response(null, { status: 400 }), {
        json: { error: { message: "Sandbox 'atlas-thread-x' not found for this project." } },
      }),
    })
    const lines: string[] = []
    let waits = 0

    const result = await probeOf({
      sandbox,
      health: FULL_IDLE,
      waitForDriveDetached: async () => {
        waits += 1
        return true
      },
      lines,
    })

    expect(result.probe).toBe(ESandboxProbe.Replaced)
    expect(waits).toBe(1)
    expect(lines.some((line) => line.includes('already gone'))).toBe(true)
  })

  it('propagates a delete failure that is not the sandbox disappearing', async () => {
    const sandbox = fakeSandbox({
      installed: STALE,
      status: 'stopped',
      deleteFailure: new APIError(new Response(null, { status: 500 }), {
        json: { error: { message: 'internal error' } },
      }),
    })

    await expect(probeOf({ sandbox })).rejects.toThrow('internal error')
  })

  it('replaces a stale sandbox that reads fully idle without draining — there is nothing in flight to preserve', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    const order: string[] = []
    Object.assign(sandbox, {
      delete: async () => {
        order.push('delete')
      },
    })

    const result = await probeOf({
      sandbox,
      health: FULL_IDLE,
      drain: async () => {
        order.push('drain')
      },
    })

    expect(order).toEqual(['delete'])
    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(result.rotatedFrom).toBe(STALE)
  })

  it('replaces a stale sandbox whose serve process is wedged — its exec works but nothing answers its port', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    let drains = 0

    const result = await probeOf({
      sandbox,
      health: undefined,
      serveAlive: false,
      drain: async () => {
        drains += 1
      },
    })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(true)
  })

  it('swaps a busy sandbox whose installed serve predates the drain protocol, without touching the gate', async () => {
    const sandbox = fakeSandbox({ installed: '1.60.3', status: 'running' })
    const order: string[] = []

    const result = await probeOf({
      sandbox,
      health: { ...FULL_IDLE, busy: true },
      drain: async () => {
        order.push('drain')
      },
      swapServe: async () => {
        order.push('swap')
      },
    })

    expect(order).toEqual(['swap'])
    expect(result.probe).toBe(ESandboxProbe.Swapped)
    expect(sandbox.deleted()).toBe(false)
  })

  it('falls back to the drain gate when the installed version cannot be parsed', async () => {
    const sandbox = fakeSandbox({ installed: 'not-a-version', status: 'running' })
    const order: string[] = []

    const result = await probeOf({
      sandbox,
      health: { ...FULL_IDLE, busy: true },
      drain: async () => {
        order.push('drain')
      },
    })

    expect(order).toEqual(['drain'])
    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(sandbox.deleted()).toBe(true)
  })

  it('still drains a stale sandbox whose serve is alive but whose idleness it cannot prove', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    const order: string[] = []

    const result = await probeOf({
      sandbox,
      health: undefined,
      drain: async () => {
        order.push('drain')
      },
    })

    expect(order).toEqual(['drain'])
    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(sandbox.deleted()).toBe(true)
  })

  it('drains and replaces a stale sandbox whose runtime is resuming', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'pending' })

    const result = await probeOf({
      sandbox,
      health: FULL_IDLE,
      drain: async () => undefined,
    })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(sandbox.deleted()).toBe(true)
  })

  it('drains a stale sandbox that reports any in-flight work, whatever the field', async () => {
    const busyVariants: ServeRuntimeHealth[] = [
      { ...FULL_IDLE, busy: true },
      { ...FULL_IDLE, childrenRunning: 1 },
      { ...FULL_IDLE, shellsRunning: 1 },
      { ...FULL_IDLE, servicesRunning: 1 },
      { ...FULL_IDLE, pendingInput: true },
      { ...FULL_IDLE, settlingWork: true },
      { ...FULL_IDLE, clients: 1 },
      { ...FULL_IDLE, turnRunning: true },
    ]

    for (const health of busyVariants) {
      const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
      const order: string[] = []
      const result = await probeOf({
        sandbox,
        health,
        drain: async () => {
          order.push('drain')
        },
      })
      expect(order).toEqual(['drain'])
      expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
      expect(sandbox.deleted()).toBe(true)
    }
  })

  it('drains a stale sandbox whose health answer is partial — idleness it cannot prove is not idle', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    const order: string[] = []

    const result = await probeOf({
      sandbox,
      health: { clients: 0 },
      drain: async () => {
        order.push('drain')
      },
    })

    expect(order).toEqual(['drain'])
    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(sandbox.deleted()).toBe(true)
  })

  it('keeps a stale sandbox whose drain fails while it reports in-flight work', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })

    await expect(
      probeOf({
        sandbox,
        health: { ...FULL_IDLE, turnRunning: true },
        drain: async () => {
          throw new Error('child x is failed instead of paused or completed')
        },
      }),
    ).rejects.toThrow('child x is failed')

    expect(sandbox.deleted()).toBe(false)
  })

  it('preserves a stale sandbox when it has no preparation route', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running', routes: [] })
    let drains = 0

    await expect(
      probeOf({
        sandbox,
        health: FULL_IDLE,
        drain: async () => {
          drains += 1
        },
      }),
    ).rejects.toThrow('nothing was destroyed')

    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(false)
  })

  it('attributes a build-drift rotation to the version mismatch', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    const lines: string[] = []

    await probeOf({ sandbox, health: FULL_IDLE, drain: async () => undefined, lines })

    const decision = lines.find((line) => line.includes('outdated against'))
    expect(decision).toBeDefined()
    expect(decision).toContain(STALE)
    expect(decision).toContain(PINNED)
  })

  it('keeps a sandbox whose serve is newer than the pin, logging why', async () => {
    const sandbox = fakeSandbox({ installed: '99.0.0', status: 'running' })
    const lines: string[] = []
    let drains = 0

    const result = await probeOf({
      sandbox,
      lines,
      drain: async () => {
        drains += 1
      },
    })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(false)
    expect(lines.some((line) => line.includes('newer than this build'))).toBe(true)
  })

  it('rotates a sandbox whose version stamp cannot be parsed', async () => {
    for (const installed of ['', 'release-branch', '1.2']) {
      const sandbox = fakeSandbox({ installed, status: 'running' })
      const result = await probeOf({ sandbox, drain: async () => undefined })
      expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
      expect(sandbox.deleted()).toBe(true)
    }
  })

  it('attributes a replacement to a confirmed provider stop', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    const lines: string[] = []

    await probeOf({ sandbox, health: FULL_IDLE, lines })

    const decision = lines.find((line) => line.includes('recreating it from the pinned image'))
    expect(decision).toBeDefined()
    expect(decision).toContain('confirmed stopped')
  })

  it('reads a version file that names the pinned serve through the sandbox', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })
    let versionReads = 0
    const counting = Object.assign(sandbox, {
      runCommand: async (params: { args?: string[] }) => {
        expect(params.args?.[1]).toContain(SERVE_VERSION_PATH)
        versionReads += 1
        return {
          exitCode: 0,
          stdout: async () => `${PINNED}\n${CHANNEL_PROTOCOL_VERSION}\n`,
          stderr: async () => '',
        }
      },
    })

    await probeOf({ sandbox: counting })

    expect(versionReads).toBe(1)
  })

  it('reads the protocol stamp in the same command as the version', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })
    const scripts: string[] = []
    Object.assign(sandbox, {
      runCommand: async (params: { args?: string[] }) => {
        scripts.push(params.args?.[1] ?? '')
        return {
          exitCode: 0,
          stdout: async () => `${PINNED}\n${CHANNEL_PROTOCOL_VERSION}\n`,
          stderr: async () => '',
        }
      },
    })

    await probeOf({ sandbox })

    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain(SERVE_PROTOCOL_PATH)
  })

  it('keeps a sandbox whose version read fails — a transient command failure is not drift', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })
    const failing = Object.assign(sandbox, {
      runCommand: async () => {
        throw new Error('runCommand unavailable')
      },
    })

    const result = await probeOf({ sandbox: failing })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(failing.deleted()).toBe(false)
  })

  it('swaps a stale running sandbox in place instead of deleting it when a swap is wired', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    const swapped: Sandbox[] = []

    const result = await probeOf({
      sandbox,
      health: FULL_IDLE,
      swapServe: async (live) => {
        swapped.push(live)
      },
    })

    expect(result.probe).toBe(ESandboxProbe.Swapped)
    expect(result.rotatedFrom).toBe(STALE)
    expect(swapped).toEqual([sandbox])
    expect(sandbox.deleted()).toBe(false)
  })

  it('drains a busy stale sandbox, then swaps it in place', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    const order: string[] = []

    const result = await probeOf({
      sandbox,
      health: { ...FULL_IDLE, turnRunning: true },
      drain: async () => {
        order.push('drain')
      },
      swapServe: async () => {
        order.push('swap')
      },
    })

    expect(order).toEqual(['drain', 'swap'])
    expect(result.probe).toBe(ESandboxProbe.Swapped)
    expect(sandbox.deleted()).toBe(false)
  })

  it('resumes a confirmed stopped sandbox in place to swap serve, preserving its filesystem', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    let swaps = 0

    const result = await probeOf({
      sandbox,
      swapServe: async () => {
        swaps += 1
      },
    })

    expect(result.probe).toBe(ESandboxProbe.Swapped)
    expect(swaps).toBe(1)
    expect(sandbox.deleted()).toBe(false)
  })

  it('leaves the sandbox intact when the in-place swap fails', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })

    await expect(
      probeOf({
        sandbox,
        health: FULL_IDLE,
        swapServe: async () => {
          throw new Error('atlas-serve 2.0.0 failed to install into the sandbox (exit 1): curl: 404')
        },
      }),
    ).rejects.toThrow('failed to install')

    expect(sandbox.deleted()).toBe(false)
  })
})
