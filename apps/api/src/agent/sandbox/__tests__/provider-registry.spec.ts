import { ESandboxProvider } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import { SandboxProviderUnavailableError, sandboxRegistryOf } from '../provider-registry'
import { SandboxProvider, type DaemonEndpoint, type SandboxTarget } from '../sandbox-provider'

class StubSandbox extends SandboxProvider {
  async wake(_args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    return { url: 'ws://stub', token: 't', sandboxName: 'n' }
  }

  async stop(_args: { target: SandboxTarget }): Promise<void> {}

  async keepAlive(_args: { target: SandboxTarget; until: number }): Promise<void> {}
}

describe('sandboxRegistryOf', () => {
  const vercel = new StubSandbox()
  const registry = sandboxRegistryOf(new Map([[ESandboxProvider.Vercel, vercel]]))

  it('answers the adapter registered for the pinned provider', () => {
    expect(registry.for(ESandboxProvider.Vercel)).toBe(vercel)
  })

  it('throws a named error for a provider with no adapter instead of falling back', () => {
    const failure = (() => {
      try {
        registry.for(ESandboxProvider.Agent37)
        return undefined
      } catch (error) {
        return error
      }
    })()
    expect(failure).toBeInstanceOf(SandboxProviderUnavailableError)
    expect((failure as SandboxProviderUnavailableError).code).toBe('SANDBOX_PROVIDER_UNAVAILABLE')
    expect((failure as Error).message).toContain(ESandboxProvider.Agent37)
  })
})
