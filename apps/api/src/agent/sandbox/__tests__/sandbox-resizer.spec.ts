import { describe, expect, it } from 'bun:test'
import { ECredentialSource, ESandboxProvider } from '@dltech/atlas-protocol'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import type { AgentHostEnv } from '../../config/env'
import { ConfigReader } from '../../config/config-reader'
import { cipher, seedOwner, seedVercel } from '../../config/__tests__/config-reader.fixture'
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

const testDb = useTestDatabase()

const PLATFORM: Pick<AgentHostEnv, 'platformVercel' | 'agent37'> = {
  platformVercel: { token: 'platform-token', teamId: 'platform-team', projectId: 'platform-proj' },
  agent37: {
    apiKey: 'a37-platform-key',
    template: 'atlas-sandbox@3',
    resources: { cpu: 2, memory: 4, disk: 20 },
  },
}

const NO_PLATFORM: Pick<AgentHostEnv, 'platformVercel' | 'agent37'> = {
  platformVercel: null,
  agent37: null,
}

class RecordingSandbox extends SandboxProvider {
  readonly resizes: { target: SandboxTarget; vcpus: number }[] = []

  async wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    throw new Error('a resize never wakes')
  }

  async stop(_args: { target: SandboxTarget }): Promise<void> {}

  async keepAlive(_args: { target: SandboxTarget; until: number }): Promise<void> {}

  async resize(args: { target: SandboxTarget; vcpus: number }): Promise<PodResizeOutcome> {
    this.resizes.push(args)
    return 'restarted'
  }

  async delete(_args: { target: SandboxTarget }): Promise<void> {}

  async list(_args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return []
  }
}

const setup = (platform: Pick<AgentHostEnv, 'platformVercel' | 'agent37'> = PLATFORM) => {
  const { db } = testDb()
  const vercel = new RecordingSandbox()
  const agent37 = new RecordingSandbox()
  const resizer: SandboxResizer = sandboxResizerOf({
    config: new ConfigReader({
      db,
      cipher,
      vercel: { refresh: async (): Promise<string> => 'refreshed-token' },
      platform,
    }),
    sandbox: sandboxRegistryOf(
      new Map([
        [ESandboxProvider.Vercel, vercel],
        [ESandboxProvider.Agent37, agent37],
      ]),
    ),
  })
  return { db, vercel, agent37, resizer }
}

const pin = async (args: {
  db: ReturnType<typeof setup>['db']
  provider: ESandboxProvider
}): Promise<void> => {
  await args.db.orm.v2.V2Session.where({ id: 's-1' }).update({
    credentialSource: ECredentialSource.Platform,
    sandboxProvider: args.provider,
  })
}

describe('sandboxResizerOf', () => {
  it('resizes a byok vercel session through the vercel adapter with the owner credential', async () => {
    const { db, vercel, agent37, resizer } = setup()
    await seedOwner(db)
    await seedVercel(db)

    await resizer.resize({ sandboxSessionId: 's-1', vcpus: 4 })

    expect(vercel.resizes).toEqual([
      {
        target: {
          sandboxSessionId: 's-1',
          credentials: {
            provider: ESandboxProvider.Vercel,
            token: 'vercel-token',
            teamId: 'team-1',
            projectId: 'vproj-1',
          },
        },
        vcpus: 4,
      },
    ])
    expect(agent37.resizes).toEqual([])
  })

  it('resizes a platform vercel session with the platform credential', async () => {
    const { db, vercel, resizer } = setup()
    await seedOwner(db)
    await pin({ db, provider: ESandboxProvider.Vercel })

    await resizer.resize({ sandboxSessionId: 's-1', vcpus: 8 })

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
        vcpus: 8,
      },
    ])
  })

  it('resizes an agent37-pinned session through the agent37 adapter', async () => {
    const { db, vercel, agent37, resizer } = setup()
    await seedOwner(db)
    await pin({ db, provider: ESandboxProvider.Agent37 })

    await resizer.resize({ sandboxSessionId: 's-1', vcpus: 4 })

    expect(agent37.resizes).toEqual([
      {
        target: {
          sandboxSessionId: 's-1',
          credentials: { provider: ESandboxProvider.Agent37, apiKey: 'a37-platform-key' },
        },
        vcpus: 4,
      },
    ])
    expect(vercel.resizes).toEqual([])
  })

  it('refuses a session whose pinned provider has no platform credential', async () => {
    const { db, vercel, agent37, resizer } = setup(NO_PLATFORM)
    await seedOwner(db)
    await pin({ db, provider: ESandboxProvider.Vercel })

    await expect(resizer.resize({ sandboxSessionId: 's-1', vcpus: 4 })).rejects.toBeInstanceOf(
      SandboxNotConfiguredError,
    )
    expect(vercel.resizes).toEqual([])
    expect(agent37.resizes).toEqual([])
  })
})
