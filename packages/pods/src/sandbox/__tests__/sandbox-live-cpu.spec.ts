import type { PodShape } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import type { SandboxConfig, SandboxConfigSource } from '../../config/sandbox-config'
import { sandboxRegistryOf, type SandboxProviderRegistry } from '../provider-registry'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '../sandbox-provider'
import { liveSandboxCpuOf } from '../sandbox-live-cpu'

const configOf = (provider: ESandboxProvider): SandboxConfig => ({
  configured: true,
  provider,
  credentials:
    provider === ESandboxProvider.Vercel
      ? { provider, token: 'vt', teamId: 'team', projectId: 'proj' }
      : { provider, apiKey: 'a37' },
  vcpus: 2,
})

const sourceOf = (config: SandboxConfig): SandboxConfigSource => ({
  read: async () => config,
})

class CpuSandbox extends SandboxProvider {
  readonly reads: SandboxTarget[] = []

  constructor(private readonly answer: () => Promise<number | undefined>) {
    super()
  }

  async wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    throw new Error('a CPU reading never wakes a sandbox')
  }

  async stop(_args: { target: SandboxTarget }): Promise<void> {}

  async keepAlive(_args: { target: SandboxTarget; until: number }): Promise<void> {}

  async resize(_args: { target: SandboxTarget; shape: PodShape }): Promise<PodResizeOutcome> {
    return 'stored'
  }

  async delete(_args: { target: SandboxTarget }): Promise<void> {}

  async list(_args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return []
  }

  override async activeCpuMs(args: { target: SandboxTarget }): Promise<number | undefined> {
    this.reads.push(args.target)
    return await this.answer()
  }
}

const setup = (args: {
  config?: SandboxConfig | undefined
  answer?: (() => Promise<number | undefined>) | undefined
  ttlMs?: number | undefined
}) => {
  const clock = { now: 1_000 }
  const config = args.config ?? configOf(ESandboxProvider.Vercel)
  const sandbox = new CpuSandbox(args.answer ?? (async () => 4_200))
  const live = liveSandboxCpuOf({
    config: sourceOf(config),
    sandbox: { for: () => sandbox } as SandboxProviderRegistry,
    now: () => clock.now,
    ...(args.ttlMs === undefined ? {} : { ttlMs: args.ttlMs }),
  })
  return { clock, sandbox, live }
}

describe('live sandbox CPU', () => {
  it('reads the running Vercel sandbox against the pod session id', async () => {
    const { live, sandbox } = setup({})

    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBe(4_200)
    expect(sandbox.reads).toEqual([
      {
        sandboxSessionId: 'pod-1',
        credentials: {
          provider: ESandboxProvider.Vercel,
          token: 'vt',
          teamId: 'team',
          projectId: 'proj',
        },
      },
    ])
  })

  it('serves a re-read from the window instead of reading again', async () => {
    const { live, sandbox, clock } = setup({})
    await live.cumulativeCpuMs({ sessionId: 'pod-1' })

    clock.now += 29_000

    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBe(4_200)
    expect(sandbox.reads).toHaveLength(1)
  })

  it('reads again once the window passes', async () => {
    const { live, sandbox, clock } = setup({})
    await live.cumulativeCpuMs({ sessionId: 'pod-1' })

    clock.now += 30_001

    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBe(4_200)
    expect(sandbox.reads).toHaveLength(2)
  })

  it('shares one reading between concurrent callers', async () => {
    const { live, sandbox } = setup({})

    const [first, second] = await Promise.all([
      live.cumulativeCpuMs({ sessionId: 'pod-1' }),
      live.cumulativeCpuMs({ sessionId: 'pod-1' }),
    ])

    expect([first, second]).toEqual([4_200, 4_200])
    expect(sandbox.reads).toHaveLength(1)
  })

  it('keeps one window per session', async () => {
    const { live, sandbox } = setup({})

    await live.cumulativeCpuMs({ sessionId: 'pod-1' })
    await live.cumulativeCpuMs({ sessionId: 'pod-2' })

    expect(sandbox.reads.map((read) => read.sandboxSessionId)).toEqual(['pod-1', 'pod-2'])
  })

  it('reads no CPU for an Agent37 session, which bills awake time', async () => {
    const { live, sandbox } = setup({ config: configOf(ESandboxProvider.Agent37) })

    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBeUndefined()
    expect(sandbox.reads).toEqual([])
  })

  it('reads no CPU for a session whose sandbox is not configured', async () => {
    const unconfigured: SandboxConfig = {
      configured: false,
      provider: ESandboxProvider.Vercel,
      gap: 'platform-credential',
    }
    const { live, sandbox } = setup({ config: unconfigured })

    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBeUndefined()
    expect(sandbox.reads).toEqual([])
  })

  it('falls back to no CPU when the reading fails, without retrying inside the window', async () => {
    let failures = 0
    const { live, sandbox } = setup({
      answer: async () => {
        failures += 1
        throw new Error('daemon unreachable')
      },
    })

    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBeUndefined()
    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBeUndefined()
    expect(failures).toBe(1)
    expect(sandbox.reads).toHaveLength(1)
  })

  it('falls back to no CPU when no adapter holds the provider', async () => {
    const config = configOf(ESandboxProvider.Vercel)
    const live = liveSandboxCpuOf({
      config: sourceOf(config),
      sandbox: sandboxRegistryOf(new Map()),
    })

    expect(await live.cumulativeCpuMs({ sessionId: 'pod-1' })).toBeUndefined()
  })
})
