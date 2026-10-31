import type { Event, ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel, TurnSpend, Unsubscribe } from '@dltech/atlas-harness'
import type {
  EThinkingVisibility,
  InFlightStep,
  TranscriptModel,
} from '@dltech/atlas-client/transcript'

import type { TurnClock } from '../ui/turn-clock'
import type { LogAccumulator, ToolEffects } from './log-accumulator'
import type { LogSummary } from './log-window'
import type { SandboxStatusSource } from './sandbox-source'
import type { SidebarModel } from './sidebar-model'
import type { ModelPriceLookup } from './sidebar-spend'
import type { TurnProgress } from './turn-progress'

export type ConversationStore = {
  subscribe(listener: () => void): Unsubscribe
  getSnapshot(): TranscriptModel
  getSidebar(): SidebarModel
  getTurn(): TurnClock
  getLogSummary(): LogSummary
  liveSteps(): InFlightStep[]
  setEvents(args: { events: readonly Event[]; turns?: readonly TurnSpend[] | undefined }): void
  resetLog(args: {
    events: readonly Event[]
    base: LogAccumulator
    turns?: readonly TurnSpend[] | undefined
  }): void
  republish(): void
  stampTurn(advance: (progress: TurnProgress) => TurnProgress): void
  supersedeFailure(): void
  resetSteps(): void
  setThinking(thinking: EThinkingVisibility): void
  setTldrStatus(tldrStatus: boolean): void
  setName(name: string | null): void
  dispose(): void
}

export type ConversationStoreArgs = {
  channel: DeltaChannel
  threadId: ThreadId
  events?: readonly Event[]
  turns?: readonly TurnSpend[]
  base?: LogAccumulator
  effects?: ToolEffects
  paceReveal?: boolean
  thinking?: EThinkingVisibility
  name?: string | null
  priceOf?: ModelPriceLookup | undefined
  projectEvents?: ((args: { events: readonly Event[] }) => void) | undefined
  sandbox?: SandboxStatusSource | undefined
  readClock?: (() => number) | undefined
}
