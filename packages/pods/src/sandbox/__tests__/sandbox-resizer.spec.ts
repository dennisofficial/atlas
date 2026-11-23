import type { PodShape } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import type { SandboxConfig, SandboxConfigSource } from '../../config/sandbox-config'
import { SandboxNotConfiguredError } from '../../runtime/sandbox-not-configured-error'
import { sandboxRegistryOf } from '../provider-registry'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '../sandbox-provider'
import { sandboxResizerOf, type SandboxResizer } from '../sandbox-resizer'

const VERCEL_4: PodShape = { vcpus: 4, memoryGb: 8 }
const VERCEL_8: PodShape = { vcpus: 8, memoryGb: 16 }

const VERCEL_CONFIG: SandboxConfig = {
  configured: true,
  provider: ESandboxProvider.Vercel,
  credentials: {
    provider: ESandboxProvider.Vercel,
    token: 'platform-token',
    teamId: 'platform-team',
    projectId: 'platform-proj',
  },
}

const AGENT37_CONFIG: SandboxConfig = {
  configured: true,
  provider: ESandboxProvider.Agent37,
  credentials: { provider: ESandboxProvider.Agent37, apiKey: 'a37-platform-key' },
}

const sourceOf = (sandbox: SandboxConfig): SandboxConfigSource => ({
  read: async () => sandbox,
})

class RecordingSandbox extends SandboxProvider {
  readonly resizes: { target: SandboxTarget; shape: PodShape }[] = []

  async wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    throw new Error('a resize never wakes')
  }

  async stop(_args: { target: SandboxTarget }): Promise<void> {}

  async keepAlive(_args: { target: SandboxTarget; until: number }): Promise<void> {}

  async resize(args: { target: SandboxTarget; shape: PodShape }): Promise<PodResizeOutcome> {
    this.resizes.push(args)
    return 'restarted'
  }

  async delete(_args: { target: SandboxTarget }): Promise<void> {}

  async list(_args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return []
  }
}

const setup = (sandbox: SandboxConfig) => {
  const vercel = new RecordingSandbox()
  const agent37 = new RecordingSandbox()
  const resizer: SandboxResizer = sandboxResizerOf({
    config: sourceOf(sandbox),
    sandbox: sandboxRegistryOf(
      new Map([
        [ESandboxProvider.Vercel, vercel],
        [ESandboxProvider.Agent37, agent37],
      ]),
    ),
  })
  return { vercel, agent37, resizer }
}

describe('sandboxResizerOf', () => {
  it('refuses a pod whose provider is not configured', async () => {
    const { vercel, agent37, resizer } = setup({
      configured: false,
      provider: ESandboxProvider.Vercel,
      gap: 'byok-retired',
    })

    await expect(
      resizer.resize({ sandboxSessionId: 's-1', shape: VERCEL_4 }),
    ).rejects.toBeInstanceOf(SandboxNotConfiguredError)
    expect(vercel.resizes).toEqual([])
    expect(agent37.resizes).toEqual([])
  })

  it('resizes a platform vercel session with the platform credential', async () => {
    const { vercel, resizer } = setup(VERCEL_CONFIG)

    await resizer.resize({ sandboxSessionId: 's-1', shape: VERCEL_8 })

    expect(vercel.resizes).toEqual([
      {
        target: {
          sandboxSessionId: 's-1',
          credentials: {
            provider: ESandboxProvider.Vercel,
            token: 'platform-token',
            teamId: 'platform-team',
            projectId: 'platform-proj',
          },
        },
        shape: VERCEL_8,
      },
    ])
  })

  it('resizes an agent37-pinned session through the agent37 adapter', async () => {
    const { vercel, agent37, resizer } = setup(AGENT37_CONFIG)

    await resizer.resize({ sandboxSessionId: 's-1', shape: VERCEL_4 })

    expect(agent37.resizes).toEqual([
      {
        target: {
          sandboxSessionId: 's-1',
          credentials: { provider: ESandboxProvider.Agent37, apiKey: 'a37-platform-key' },
        },
        shape: VERCEL_4,
      },
    ])
    expect(vercel.resizes).toEqual([])
  })

  it('passes a disk grow through to the adapter', async () => {
    const { vercel, resizer } = setup(VERCEL_CONFIG)

    await resizer.resize({ sandboxSessionId: 's-1', shape: VERCEL_4, diskGb: 60 })

    expect(vercel.resizes).toHaveLength(1)
  })
})
