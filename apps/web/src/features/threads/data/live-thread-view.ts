import type { RemoteDeltaChannel, TerminalFrameChannel } from '@dltech/atlas-client/channel'
import type { InFlightStep } from '@dltech/atlas-client/transcript'
import type { CallId, ModelUsage } from '@dltech/atlas-core'
import type { OperatorInputRequestWire, PendingEntryWire, WireEvent } from '@dltech/atlas-wire/web'

export type ServeChannel = RemoteDeltaChannel & TerminalFrameChannel

export type LiveThreadState = {
  events: WireEvent[]
  outputs: ReadonlyMap<CallId, string>
  working: boolean
  live: boolean
  pending: readonly PendingEntryWire[]
  reported: ModelUsage | null
  channel: ServeChannel | null
  operatorInput: OperatorInputRequestWire | null
}

export type LiveSend = (args: { text: string; requestId: string }) => boolean

export type ThreadModelChoice = { ref: string; effort: string }

export type LiveChooseModel = (model: ThreadModelChoice) => Promise<boolean>

export type LiveTakeBackPending = () => Promise<string | null>

export type LiveThreadView = LiveThreadState & {
  steps: InFlightStep[]
  send: LiveSend
  chooseModel: LiveChooseModel
  takeBackPending: LiveTakeBackPending
}

export const IDLE_LIVE_THREAD: LiveThreadState = {
  events: [],
  outputs: new Map(),
  working: false,
  live: false,
  pending: [],
  reported: null,
  channel: null,
  operatorInput: null,
}
