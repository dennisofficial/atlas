import { ESandboxProvider } from '@dltech/atlas-protocol'

import {
  sandboxRegistryOf,
  type SandboxProviderRegistry,
} from '@dltech/atlas-pods/sandbox/provider-registry'
import type { SandboxProvider } from '@dltech/atlas-pods/sandbox/sandbox-provider'

export const singleProviderRegistry = (adapter: SandboxProvider): SandboxProviderRegistry =>
  sandboxRegistryOf(new Map([[ESandboxProvider.Vercel, adapter]]))
