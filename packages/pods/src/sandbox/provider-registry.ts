import type { ESandboxProvider } from '@dltech/atlas-protocol'

import type { SandboxProvider } from './sandbox-provider'

export class SandboxProviderUnavailableError extends Error {
  readonly code = 'SANDBOX_PROVIDER_UNAVAILABLE'

  constructor(public readonly provider: ESandboxProvider) {
    super(`no sandbox adapter is registered for the ${provider} provider`)
    this.name = 'SandboxProviderUnavailableError'
  }
}

export type SandboxProviderRegistry = {
  for(provider: ESandboxProvider): SandboxProvider
}

export const sandboxRegistryOf = (
  adapters: ReadonlyMap<ESandboxProvider, SandboxProvider>,
): SandboxProviderRegistry => ({
  for: (provider) => {
    const adapter = adapters.get(provider)
    if (adapter === undefined) throw new SandboxProviderUnavailableError(provider)
    return adapter
  },
})
