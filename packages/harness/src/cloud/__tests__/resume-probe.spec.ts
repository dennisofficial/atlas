import { describe, expect, it } from 'bun:test'

import { APIError, Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire'
import { SERVE_PROTOCOL_PATH, SERVE_VERSION_PATH } from '../serve-launch'
import {
  ESandboxProbe,
  ERuntimeIdle,
  EServeAge,
  probeRuntimeActivity,
  runtimeIdleOf,
  probeSandboxForResume,
  serveAgeOf,
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

const fakeSandbox = (args: {
  installed: string
  protocol?: string
  status?: string
  routes?: number[]
}) => {
  const protocol = args.protocol ?? String(CHANNEL_PROTOCOL_VERSION)
  let deleted = false
  const routedPorts = args.routes ?? [3000]
  const base = {
    name: 'atlas-thread-x',
    status: args.status ?? 'running',
    runCommand: async () => ({
      exitCode: 0,
      stdout: async () => `${args.installed}\n${protocol}\n`,
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
  unpinned?: boolean
  health?: ServeRuntimeHealth | undefined
  healthThrows?: boolean
  waitForDriveDetached?: () => Promise<boolean>
  drain?: (args: { sandbox: Sandbox; url: string }) => Promise<void>
  onRotationStarted?: () => void
  lines?: string[]
}) =>
  probeSandboxForResume({
    name: 'atlas-thread-x',
    pinned: args.unpinned === true ? undefined : PINNED,
    timeoutMs: 5_000,
    servePort: 3000,
    fetch: async () => args.sandbox,
    runtimeHealth: async () => {
      if (args.healthThrows === true) throw new Error('command unavailable')
      return args.health
    },
    ...(args.drain === undefined ? {} : { drain: args.drain }),
    ...(args.onRotationStarted === undefined ? {} : { onRotationStarted: args.onRotationStarted }),
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

  it('replaces a confirmed stopped sandbox without commands that would auto-wake it', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'stopped' })
    let commands = 0
    Object.assign(sandbox, { runCommand: async () => { commands += 1; throw new Error('runCommand would resume the stopped sandbox') } })
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

  it('drains and replaces a stale sandbox whose runtime is running, however idle its health reads', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
    const order: string[] = []
    Object.assign(sandbox, { delete: async () => { order.push('delete') } })

    const result = await probeOf({
      sandbox,
      health: FULL_IDLE,
      drain: async () => { order.push('drain') },
    })

    expect(order).toEqual(['drain', 'delete'])
    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(result.rotatedFrom).toBe(STALE)
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

  it('rotates a running stale sandbox whatever its runtime health reports', async () => {
    const healthVariants: (ServeRuntimeHealth | undefined)[] = [
      FULL_IDLE,
      { ...FULL_IDLE, busy: true },
      { ...FULL_IDLE, childrenRunning: 1 },
      { ...FULL_IDLE, shellsRunning: 1 },
      { ...FULL_IDLE, servicesRunning: 1 },
      { ...FULL_IDLE, pendingInput: true },
      { ...FULL_IDLE, settlingWork: true },
      { ...FULL_IDLE, clients: 1 },
      { ...FULL_IDLE, turnRunning: true },
      { clients: 0 },
      undefined,
    ]

    for (const health of healthVariants) {
      const sandbox = fakeSandbox({ installed: STALE, status: 'running' })
      const result = await probeOf({ sandbox, health, drain: async () => undefined })
      expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
      expect(sandbox.deleted()).toBe(true)
    }
  })

  it('deletes a stale sandbox without a drain when it has no routed URL', async () => {
    const sandbox = fakeSandbox({ installed: STALE, status: 'running', routes: [] })
    let drains = 0

    const result = await probeOf({ sandbox, health: FULL_IDLE, drain: async () => { drains += 1 } })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(true)
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

    const result = await probeOf({ sandbox, lines, drain: async () => { drains += 1 } })

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
        return { exitCode: 0, stdout: async () => `${PINNED}\n`, stderr: async () => '' }
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
        return { exitCode: 0, stdout: async () => `${PINNED}\n${CHANNEL_PROTOCOL_VERSION}\n`, stderr: async () => '' }
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
})

describe('probeSandboxForResume protocol rotation', () => {
  const STALE_PROTOCOL = String(CHANNEL_PROTOCOL_VERSION - 1)

  it('keeps a sandbox whose protocol stamp matches, never draining', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })
    let drains = 0

    const result = await probeOf({ sandbox, drain: async () => { drains += 1 } })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(false)
  })

  it('drains a live mismatched serve before deleting it, whatever its runtime is doing', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })
    const order: string[] = []
    Object.assign(sandbox, { delete: async () => { order.push('delete') } })
    const drained: { url: string }[] = []

    const result = await probeOf({
      sandbox,
      health: { ...FULL_IDLE, busy: true, clients: 2 },
      drain: async ({ url }) => {
        order.push('drain')
        drained.push({ url })
      },
    })

    expect(order).toEqual(['drain', 'delete'])
    expect(drained).toEqual([{ url: 'https://sb-3000.vercel.run' }])
    expect(result).toEqual({
      probe: ESandboxProbe.RotationNeeded,
      outdatedProtocol: CHANNEL_PROTOCOL_VERSION - 1,
    })
  })

  it('treats a missing or empty protocol stamp as a serve that predates it', async () => {
    for (const protocol of ['', 'garbage']) {
      const sandbox = fakeSandbox({ installed: PINNED, protocol })
      let drains = 0

      const result = await probeOf({ sandbox, drain: async () => { drains += 1 } })

      expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
      expect(result.outdatedProtocol).toBe(0)
      expect(drains).toBe(1)
      expect(sandbox.deleted()).toBe(true)
    }
  })

  it('rotates on protocol drift even when the build version also drifted', async () => {
    const sandbox = fakeSandbox({ installed: STALE, protocol: STALE_PROTOCOL })

    const result = await probeOf({ sandbox, drain: async () => {} })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(result.rotatedFrom).toBeUndefined()
    expect(sandbox.deleted()).toBe(true)
  })

  it('still deletes when the drain is rejected, logging why', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })
    const lines: string[] = []

    const result = await probeOf({
      sandbox,
      lines,
      drain: async () => {
        throw new Error('the serve answered the drain with HTTP 404')
      },
    })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(sandbox.deleted()).toBe(true)
    expect(lines.some((line) => line.includes('HTTP 404') && line.includes('deleting it anyway'))).toBe(true)
  })

  it('deletes without a drain when the sandbox has no routed URL', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL, routes: [] })
    let drains = 0

    const result = await probeOf({ sandbox, drain: async () => { drains += 1 } })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(true)
  })

  it('announces the rotation before the drain starts, and survives a throwing callback', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })
    const order: string[] = []
    const lines: string[] = []

    const result = await probeOf({
      sandbox,
      lines,
      onRotationStarted: () => {
        order.push('started')
        throw new Error('drawer unmounted')
      },
      drain: async () => { order.push('drain') },
    })

    expect(order).toEqual(['started', 'drain'])
    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(lines.some((line) => line.includes('drawer unmounted'))).toBe(true)
  })

  it('announces a build-drift rotation too, and stays quiet for a matching sandbox', async () => {
    let announced = 0
    const onRotationStarted = () => { announced += 1 }

    await probeOf({ sandbox: fakeSandbox({ installed: STALE }), health: FULL_IDLE, onRotationStarted, drain: async () => undefined })
    await probeOf({ sandbox: fakeSandbox({ installed: PINNED }), onRotationStarted })

    expect(announced).toBe(1)
  })

  it('replaces a stopped sandbox without draining or announcing', async () => {
    const sandbox = fakeSandbox({ installed: STALE, protocol: STALE_PROTOCOL, status: 'stopped' })
    let drains = 0
    let announced = 0

    const result = await probeOf({
      sandbox,
      drain: async () => { drains += 1 },
      onRotationStarted: () => { announced += 1 },
    })

    expect(result.probe).toBe(ESandboxProbe.Replaced)
    expect(drains).toBe(0)
    expect(announced).toBe(0)
  })

  it('rotates on protocol drift even when the build pins no serve version', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })

    const result = await probeOf({ sandbox, unpinned: true, drain: async () => undefined })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(result.outdatedProtocol).toBe(CHANNEL_PROTOCOL_VERSION - 1)
    expect(sandbox.deleted()).toBe(true)
  })

  it('keeps a protocol-matching sandbox when the build pins no serve version, whatever version it carries', async () => {
    const sandbox = fakeSandbox({ installed: '9.9.9' })

    const result = await probeOf({ sandbox, unpinned: true })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(sandbox.deleted()).toBe(false)
  })
})

describe('serveAgeOf', () => {
  it('compares by major, then minor, then patch', () => {
    expect(serveAgeOf({ installed: '1.0.0', pinned: '2.0.0' })).toBe(EServeAge.Older)
    expect(serveAgeOf({ installed: '1.48.2', pinned: '1.49.0' })).toBe(EServeAge.Older)
    expect(serveAgeOf({ installed: '1.48.2', pinned: '1.48.10' })).toBe(EServeAge.Older)
    expect(serveAgeOf({ installed: '2.0.0', pinned: '2.0.0' })).toBe(EServeAge.Same)
    expect(serveAgeOf({ installed: '2.0.1', pinned: '2.0.0' })).toBe(EServeAge.Newer)
    expect(serveAgeOf({ installed: '3.0.0', pinned: '2.9.9' })).toBe(EServeAge.Newer)
  })

  it('reads unparsable versions as unknown', () => {
    expect(serveAgeOf({ installed: '', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
    expect(serveAgeOf({ installed: 'release-branch', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
    expect(serveAgeOf({ installed: '1.2', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
    expect(serveAgeOf({ installed: '1.2.x', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
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
