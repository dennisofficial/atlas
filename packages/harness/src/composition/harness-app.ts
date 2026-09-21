import type {
  CredentialPort,
  EventLogPort,
  IdPort,
  NoticePort,
  SaidImage,
  SecretsPort,
  ThreadId,
  WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { AgentTypeCatalog } from '../agents/types/registry'
import type { UrlOpener } from '../browser/open-url'
import type { DeltaChannel } from '../channel/delta-channel'
import type { CloudService } from '../cloud/cloud-service'
import type { DependencyContainer } from '../container/injection'
import type { AccountsService } from '../credentials/accounts-service'
import type { FileBrowser } from '../files/file-browser'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { TldrFeed } from '../loop/tldr-turn-runner'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { McpServerStatus } from '../mcp/registry/handle-status'
import type { PendingQueues } from '../pending'
import type { ContributedProjection } from '../plugins/projection'
import type { ContributedSurface } from '../plugins/surface'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { SettingsService } from '../settings/service'
import type { ShellRegistryPort } from '../shells/shell-registry'
import type { DiscoveredSkill } from '../skills/skill'
import type { SkillRegistryPort } from '../skills/port'
import type { ThreadStorePort } from '../store/thread-store'
import type { ToolRegistry } from '../tools/registry'
import type { AccountUsageService } from '../usage/account-usage-service'

import type { Summariser } from './compact-turn'
import type { HarnessLaunch } from './config'
import type { ExecutionLocationState } from './execution-location-state'
import type { ModelCatalogue } from './model-catalogue'
import type { ModelChoice } from './model-selection'
import type { ActiveConversation } from './resume-hint'
import type { SandboxControl } from './sandbox-binding'
import type { SandboxStatusState } from './sandbox-status-state'

export type SessionTitler = (args: {
  text: string
  images?: readonly SaidImage[] | undefined
  signal?: AbortSignal | undefined
}) => Promise<string | null>

/**
 * The surface's half of the composition contract. `bind` runs after every built-in registration —
 * including native and repo plugin contributions, assembled by `composeHarness` itself so every
 * surface gets them — and before the instance-cached HookChain/ToolRegistry first resolve; its
 * return rides out on `HarnessApp.surface`.
 */
export type HarnessSurfaceBinding<TSurface = undefined> = {
  notice: NoticePort
  tldrFeed?: TldrFeed | undefined
  bind?: ((args: { container: DependencyContainer }) => TSurface | Promise<TSurface>) | undefined
}

export type HarnessStoreBinding = {
  bind: (args: { container: DependencyContainer }) => void | Promise<void>
}

/** What a composed session hands its surface. Nothing here renders. */
export type HarnessApp<TSurface = undefined, Command = never, TPluginSurface = unknown> = {
  launch: HarnessLaunch
  workspace: WorkspaceIdentity
  tools: ToolRegistry
  markActiveThread: (active: ActiveConversation) => void
  activeThread: () => ActiveConversation | null
  titler: SessionTitler
  summarise: Summariser
  credentials: CredentialPort
  accounts: AccountsService
  cloud: CloudService
  channel: DeltaChannel
  runner: TurnRunner
  log: EventLogPort
  threads: ThreadStorePort
  ledger: TurnLedgerPort
  ids: IdPort
  pending: PendingQueues<Command>
  shells: ShellRegistryPort
  agents: AgentRegistryPort
  services: ServiceRegistryPort
  sandbox: SandboxControl
  containerStatus: SandboxStatusState
  cloudRequired: boolean
  model: ModelChoice
  modelPinned: boolean
  models: ModelCatalogue
  executionLocation: ExecutionLocationState
  executionPinned: boolean
  settings: SettingsService
  secrets: SecretsPort
  usage: AccountUsageService
  files: FileBrowser
  openUrl: UrlOpener
  skills: readonly DiscoveredSkill[]
  skillRegistry: SkillRegistryPort
  agentTypes: AgentTypeCatalog
  mcp: () => readonly McpServerStatus[]
  threadOpened: (args: { threadId: ThreadId; projectDirectory: string }) => Promise<void>
  journalResume: (args: { active: ActiveConversation; directory: string }) => void
  pluginProjections: readonly ContributedProjection[]
  pluginSurfaces: readonly ContributedSurface<TPluginSurface>[]
  surface: TSurface
  close: () => Promise<void>
}
