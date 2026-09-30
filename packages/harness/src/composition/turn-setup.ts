import type { CapabilitiesSource, ModelPort, NoticePort, SaidImage, SettingsResolution, ToolDeclaration, WorkspaceIdentity } from '@dltech/atlas-core'
import type { SleepPrevention } from '../power/sleep-prevention'
import type { WakeSignal } from '../wake/wake-signals'
import type { LanguageModel } from 'ai'

import type { DeltaChannel } from '../channel/delta-channel'
import type { DependencyContainer } from '../container/injection'
import type { TldrFeed } from '../loop/tldr-turn-runner'
import type { PendingQueues } from '../pending'
import type { PromptRegistry } from '../prompt/registry'
import type { SettingsService } from '../settings/service'
import type { Summariser } from './compact-turn'
import type { ExecutionLocationState } from './execution-location-state'
import type { ModelCatalogue } from './model-catalogue'
import type { SelectableModel } from './model-selection'

export type TurnSetup<Command = never> = {
  container: DependencyContainer
  workspace: WorkspaceIdentity
  executionLocation: ExecutionLocationState
  capabilities?: CapabilitiesSource | undefined
  mounts: readonly string[]
  models: ModelCatalogue
  model: SelectableModel
  modelPort: ModelPort
  prompts: PromptRegistry
  declarations: () => readonly ToolDeclaration[]
  pending: PendingQueues<Command>
  channel: DeltaChannel
  notice: NoticePort
  summarise: Summariser
  settings: SettingsService
  decisionsEnabled: () => boolean
  stopSandbox: () => Promise<boolean>
  settled: SettingsResolution
  tldr: { feed: TldrFeed | undefined; model: LanguageModel; modelId: () => string }
  titler: (args: { text: string; images?: readonly SaidImage[] | undefined }) => Promise<string | null>
  sleepPrevention?: SleepPrevention | undefined
  wake?: WakeSignal | undefined
}
