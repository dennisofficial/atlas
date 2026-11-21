import { describe, expect, it } from 'bun:test'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { ConfigSource, SandboxConfig } from '../../config/agent-host-config'
import { SandboxNotConfiguredError } from '../../runtime/sandbox-not-configured-error'
import type { SandboxProviderRegistry } from '../provider-registry'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '../sandbox-provider'
import { sandboxSleeperOf } from '../sandbox-sleeper'

const CREDENTIALS: SandboxCredentials = { provider: ESandboxProvider.Agent37, apiKey: 'key' }

class RecordingProvider extends SandboxProvider {
  readonly stopped: SandboxTarget[] = []

  async wake(): Promise<DaemonEndpoint> {
    throw new Error('the sleeper never wakes a pod')
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    this.stopped.push(args.target)
  }

  async keepAlive(): Promise<void> {}

  async resize(): Promise<PodResizeOutcome> {
    throw new Error('the sleeper never resizes a pod')
  }

  async delete(): Promise<void> {}

  async list(): Promise<readonly SandboxListing[]> {
    return []
  }
}

const configOf = (sandbox: SandboxConfig): ConfigSource =>
  ({
    read: async () => ({ sandbox }),
  }) as unknown as ConfigSource

const sleeperOf = (args: { sandbox: SandboxConfig; provider: SandboxProvider }) =>
  sandboxSleeperOf({
    config: configOf(args.sandbox),
    sandbox: { for: () => args.provider } as SandboxProviderRegistry,
  })

describe('sandboxSleeperOf', () => {
  it('stops the pod on the provider and credentials the session runs on', async () => {
    const provider = new RecordingProvider()
    const sleeper = sleeperOf({
      sandbox: { configured: true, provider: ESandboxProvider.Agent37, credentials: CREDENTIALS },
      provider,
    })

    await sleeper.sleep({ sandboxSessionId: 'pod-1' })

    expect(provider.stopped).toEqual([{ sandboxSessionId: 'pod-1', credentials: CREDENTIALS }])
  })

  it('refuses a pod whose provider is not configured', async () => {
    const sleeper = sleeperOf({
      sandbox: { configured: false, provider: ESandboxProvider.Agent37, gap: 'no key' },
      provider: new RecordingProvider(),
    })

    await expect(sleeper.sleep({ sandboxSessionId: 'pod-1' })).rejects.toThrow(
      SandboxNotConfiguredError,
    )
  })
})
