import type { RemoteDeltaChannel, TerminalFrameChannel } from '@dltech/atlas-client/channel'
import type { InFlightStep } from '@dltech/atlas-client/transcript'
import type { CallId, ModelUsage, SaidUpload } from '@dltech/atlas-core'
import type {
  OperatorInputRequestWire,
  PendingEntryWire,
  RewindCutWire,
  RosterWire,
  SaidImageWire,
  WireEvent,
} from '@dltech/atlas-wire/web'

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
  titling: boolean
  liveTitle: string | null
}

export type LiveSend = (args: {
  text: string
  requestId: string
  images?: SaidImageWire[]
  uploads?: SaidUpload[]
}) => boolean

export type ThreadModelChoice = { ref: string; effort: string }

export type LiveChooseModel = (model: ThreadModelChoice) => Promise<boolean>

export type TakenBack = {
  text: string
  images: readonly SaidImageWire[]
  uploads: readonly SaidUpload[]
}

export type LiveTakeBackPending = () => Promise<TakenBack | null>

export type LiveInterrupt = () => boolean

export type LiveRetry = (args?: { resume?: boolean }) => boolean

export type LiveDismissFailure = (args: { failureSeq: number }) => boolean

export type LiveApplyRewind = (args: {
  cuts: readonly RewindCutWire[]
  toSeq: number
}) => Promise<void>

export type LiveReadRoster = () => Promise<RosterWire | null>

export type LivePrepareRewind = () => Promise<{
  events: readonly WireEvent[]
  working: boolean
  roster: RosterWire
}>

export type LiveThreadView = LiveThreadState & {
  steps: InFlightStep[]
  send: LiveSend
  chooseModel: LiveChooseModel
  takeBackPending: LiveTakeBackPending
  interrupt: LiveInterrupt
  retry: LiveRetry
  dismissFailure: LiveDismissFailure
  applyRewind: LiveApplyRewind
  readRoster: LiveReadRoster
  prepareRewind?: LivePrepareRewind | undefined
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
  titling: false,
  liveTitle: null,
}
