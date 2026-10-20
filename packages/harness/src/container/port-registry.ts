import type { PortRegistryEntry } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { FileReadStatePort } from '../files/read-state'
import type { MemoryPort } from '../memory/memory-port'
import type { FileWriteGuardPort } from '../files/write-guard'
import type { OperatorInputPort } from '../operator-input/port'
import type { GithubUiBridgePort } from '../plugins/github/ui-bridge'
import type { AppInstallRecommendationSink } from '../plugins/github/app-install-sink'
import type { PullRequestPort } from '../plugins/github/pure/port'
import type { PrEventFrameSink } from '../plugins/github/pr-event-sink'
import type { PromptRegistry } from '../prompt/registry'
import type { RotationPort } from '../rotation/rotation-port'
import type { ServiceRegistryPort } from '../services/service-registry-port'
import type { ShellLauncherPort, ShellRegistryPort } from '../shells/port'
import type { SkillRegistryPort } from '../skills/port'
import type { SessionAuthorityPort } from '../store/sessions/meta'
import type { ThreadStorePort } from '../store/thread-store'
import type { ToolRegistry } from '../tools/registry'
import type { ToolDispatcher } from '../tools/dispatch'
import type { UserLayerSyncPort } from '../user-layer-sync/port'

declare module '@dltech/atlas-core' {
  interface PortRegistryEntries {
    readonly ThreadStorePort: PortRegistryEntry<ThreadStorePort> & { readonly transport: 'detached' }
    readonly TurnLedgerPort: PortRegistryEntry<TurnLedgerPort> & { readonly transport: 'detached' }
    readonly SessionAuthorityPort: PortRegistryEntry<SessionAuthorityPort> & {
      readonly transport: 'none'
    }
    readonly RotationPort: PortRegistryEntry<RotationPort> & { readonly transport: 'detached' }
    readonly FileReadStatePort: PortRegistryEntry<FileReadStatePort> & { readonly transport: 'none' }
    readonly FileWriteGuardPort: PortRegistryEntry<FileWriteGuardPort> & {
      readonly transport: 'none'
    }
    readonly ShellRegistryPort: PortRegistryEntry<ShellRegistryPort> & {
      readonly transport: 'detached'
    }
    readonly ShellLauncherPort: PortRegistryEntry<ShellLauncherPort> & { readonly transport: 'none' }
    readonly AgentRegistryPort: PortRegistryEntry<AgentRegistryPort> & {
      readonly transport: 'detached'
    }
    readonly ServiceRegistryPort: PortRegistryEntry<ServiceRegistryPort> & {
      readonly transport: 'detached'
    }
    readonly OperatorInputPort: PortRegistryEntry<OperatorInputPort> & { readonly transport: 'none' }
    readonly SkillRegistryPort: PortRegistryEntry<SkillRegistryPort> & { readonly transport: 'none' }
    readonly ToolRegistry: PortRegistryEntry<ToolRegistry> & { readonly transport: 'none' }
    readonly ToolDispatcher: PortRegistryEntry<ToolDispatcher> & { readonly transport: 'none' }
    readonly PromptRegistry: PortRegistryEntry<PromptRegistry> & { readonly transport: 'none' }
    readonly GithubUiBridgePort: PortRegistryEntry<GithubUiBridgePort> & {
      readonly transport: 'none'
    }
    readonly PullRequestPort: PortRegistryEntry<PullRequestPort> & { readonly transport: 'none' }
    readonly PrEventFrameSink: PortRegistryEntry<PrEventFrameSink> & { readonly transport: 'none' }
    readonly AppInstallRecommendationSink: PortRegistryEntry<AppInstallRecommendationSink> & {
      readonly transport: 'none'
    }
    readonly UserLayerSyncPort: PortRegistryEntry<UserLayerSyncPort> & { readonly transport: 'none' }
    readonly MemoryPort: PortRegistryEntry<MemoryPort> & { readonly transport: 'none' }
  }
}
