import { describe, expect, it } from 'bun:test'

import { APIError, Sandbox } from '@vercel/sandbox'

import { SERVE_VERSION_PATH } from '../serve-launch'
import {
  ESandboxProbe,
  ERuntimeIdle,
  probeRuntimeActivity,
  runtimeIdleOf,
  probeSandboxForResume,
  type ServeRuntimeHealth,
} from '../resume-probe'
import { asVercelFailure, isSandboxMissing } from '../vercel-errors'

const PINNED = '2.0.0'

const STALE = '1.0.0'

const FULL_IDLE: ServeRuntimeHealth = {
  busy: false,
  childrenRunning: 0,
  shellsRunning: 0,
  servicesRunning: 0,
  pendingInput: false,
  settlingWork: false,
  clients: 0,
}

const fakeSandbox = (args: { installed: string; status?: string; routes?: number[] }) => {
  let deleted = false
  const routedPorts = args.routes ?? [3000]
  const base = {
    name: 'atlas-thread-x',
    status: args.status ?? 'stopped',
    runCommand: async () => ({
      exitCode: 0,
      stdout: async () => `${args.installed}\n`,
      stderr: async () => '',
    }),
    domain: (port: number) => {
      if (!routedPorts.includes(port)) throw new Error('no route')
      return `https://sb-${port}.vercel.run`
    },
    delete: async () => {
      deleted = true
    },
  }
  const sandbox = base as unknown as Sandbox
  return Object.assign(sandbox, { deleted: () => deleted }) as Sandbox & {
    deleted: () => boolean
  }
}

const probeOf = (args: {
  sandbox: Sandbox
  health?: ServeRuntimeHealth | undefined
  healthThrows?: boolean
  waitForDriveDetached?: () => Promise<boolean>
  lines?: string[]
}) =>
  probeSandboxForResume({
    name: 'atlas-thread-x',
    pinned: PINNED,
    timeoutMs: 5_000,
    servePort: 3000,
    fetch: async () => args.sandbox,
    runtimeHealth: async () => {
      if (args.healthThrows === true) throw new Error('command unavailable')
      return args.health
    },
    ...(args.waitForDriveDetached === undefined
      ? {}
      : { waitForDriveDetached: args.waitForDriveDetached }),
    log: args.lines === undefined ? undefined : (line) => args.lines?.push(line),
    isMissing: isSandboxMissing,
    toFailure: asVercelFailure,
  })

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

  it('replaces a stale sandbox whose runtime is parked once health proves it fully idle', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
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

  it('never replaces a stale sandbox whose runtime is running, however idle its health reads', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })

    const result = await probeOf({ sandbox, health: FULL_IDLE })

    expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
    expect(result.outdatedServe).toBe(STALE)
    expect(sandbox.deleted()).toBe(false)
  })

  it('never replaces a stale sandbox whose runtime is resuming', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'pending' })

    const result = await probeOf({ sandbox, health: FULL_IDLE })

    expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
    expect(sandbox.deleted()).toBe(false)
  })

  it('preserves a parked stale sandbox while any guarded field reports work', async () => {
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
      const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
      const result = await probeOf({ sandbox, health })
      expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
      expect(sandbox.deleted()).toBe(false)
    }
  })

  it('preserves a parked stale sandbox when any guarded field is missing from the health answer', async () => {
    const incomplete: ServeRuntimeHealth = { ...FULL_IDLE }
    delete incomplete.settlingWork

    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })

    const result = await probeOf({ sandbox, health: incomplete })

    expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
    expect(sandbox.deleted()).toBe(false)
  })

  it('preserves a parked stale sandbox when health cannot be read at all', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })

    const result = await probeOf({ sandbox, health: undefined })

    expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
    expect(sandbox.deleted()).toBe(false)
  })

  it('preserves a parked stale sandbox when the health read throws', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })

    const result = await probeOf({ sandbox, healthThrows: true })

    expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
    expect(sandbox.deleted()).toBe(false)
  })

  it('preserves a parked stale sandbox when it has no routed URL to probe', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped', routes: [] })

    const result = await probeOf({ sandbox, health: FULL_IDLE })

    expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
    expect(sandbox.deleted()).toBe(false)
  })

  it('treats a legacy health answer carrying only clients as unknown rather than idle', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    const lines: string[] = []

    const result = await probeOf({ sandbox, health: { clients: 0 }, lines })

    expect(result.probe).toBe(ESandboxProbe.OutdatedPreserved)
    expect(sandbox.deleted()).toBe(false)
    expect(lines.some((line) => line.includes('unreported'))).toBe(true)
  })

  it('attributes a preservation decision to the fields that forced it', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    const lines: string[] = []

    await probeOf({
      sandbox,
      health: { ...FULL_IDLE, shellsRunning: 2, settlingWork: true },
      lines,
    })

    const decision = lines.find((line) => line.includes('never proved idle'))
    expect(decision).toBeDefined()
    expect(decision).toContain('shellsRunning=2')
    expect(decision).toContain('settlingWork')
  })

  it('attributes a replacement to the idle fields that proved it', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    const lines: string[] = []

    await probeOf({ sandbox, health: FULL_IDLE, lines })

    const decision = lines.find((line) => line.includes('recreating it from the pinned image'))
    expect(decision).toBeDefined()
    expect(decision).toContain('clients=0')
    expect(decision).toContain('settlingWork=false')
  })

  it('reads a version file that names the pinned serve through the sandbox', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })
    let versionReads = 0
    const counting = Object.assign(sandbox, {
      runCommand: async (params: { args?: string[] }) => {
        expect(params.args?.[1]).toContain(SERVE_VERSION_PATH)
        versionReads += 1
        return { exitCode: 0, stdout: async () => `${PINNED}\n`, stderr: async () => '' }
      },
    })

    await probeOf({ sandbox: counting })

    expect(versionReads).toBe(1)
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
})

describe('runtimeIdleOf', () => {
  it('reads undefined health as unknown', () => {
    expect(runtimeIdleOf(undefined)).toBe(ERuntimeIdle.Unknown)
  })

  it('reads a fully quiet answer as idle', () => {
    expect(runtimeIdleOf(FULL_IDLE)).toBe(ERuntimeIdle.Idle)
  })

  it('reads any single missing guarded field as unknown', () => {
    const withoutClients: ServeRuntimeHealth = { ...FULL_IDLE }
    delete withoutClients.clients
    expect(runtimeIdleOf(withoutClients)).toBe(ERuntimeIdle.Unknown)
  })

  it('reads legacy turnRunning alone as busy, never as proof of idleness', () => {
    expect(runtimeIdleOf({ ...FULL_IDLE, turnRunning: true })).toBe(ERuntimeIdle.Busy)
    expect(runtimeIdleOf({ turnRunning: false, clients: 0 })).toBe(ERuntimeIdle.Unknown)
  })
})

describe('probeRuntimeActivity', () => {
  const healthSandbox = (args: { body?: string; exitCode?: number; throws?: boolean }) => {
    const sandbox = {
      name: 'atlas-thread-x',
      runCommand: async () => {
        if (args.throws === true) throw new Error('command unavailable')
        return { exitCode: args.exitCode ?? 0, stdout: async () => args.body ?? '' }
      },
    }
    return sandbox as unknown as Sandbox
  }

  it('parses a complete activity answer', async () => {
    const sandbox = healthSandbox({ body: JSON.stringify(FULL_IDLE) })

    const health = await probeRuntimeActivity({ sandbox, url: 'https://sb-3000.vercel.run' })

    expect(health).toEqual(FULL_IDLE)
  })

  it('reads a failed health fetch as unknown, not as unattached', async () => {
    for (const sandbox of [
      healthSandbox({ exitCode: 1 }),
      healthSandbox({ throws: true }),
      healthSandbox({ body: '' }),
      healthSandbox({ body: 'not json' }),
      healthSandbox({ body: JSON.stringify({ clients: 'many' }) }),
    ]) {
      const health = await probeRuntimeActivity({ sandbox, url: 'https://sb-3000.vercel.run' })
      expect(health).toBeUndefined()
    }
  })

  it('tolerates extra fields a newer serve reports', async () => {
    const sandbox = healthSandbox({
      body: JSON.stringify({ ...FULL_IDLE, uptimeMs: 42, workspace: { state: 'ready' } }),
    })

    const health = await probeRuntimeActivity({ sandbox, url: 'https://sb-3000.vercel.run' })

    expect(health).toMatchObject(FULL_IDLE)
  })
})
