import { ESandboxProvider } from '@dltech/atlas-protocol'

import { sandboxRegistryOf, type SandboxProviderRegistry } from '../sandbox/provider-registry'
import type { SandboxProvider } from '../sandbox/sandbox-provider'

export const singleProviderRegistry = (adapter: SandboxProvider): SandboxProviderRegistry =>
  sandboxRegistryOf(new Map([[ESandboxProvider.Vercel, adapter]]))
