import type { StepSignal } from '@dltech/atlas-client/channel'
import type { CallId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

export type LiveThreadState = {
  events: WireEvent[]
  signals: StepSignal[]
  outputs: ReadonlyMap<CallId, string>
  working: boolean
  live: boolean
}

export type LiveSend = (args: { text: string; requestId: string }) => boolean

export type ThreadModelChoice = { ref: string; effort: string }

export type LiveChooseModel = (model: ThreadModelChoice) => Promise<boolean>

export type LiveThreadView = LiveThreadState & { send: LiveSend; chooseModel: LiveChooseModel }

export const IDLE_LIVE_THREAD: LiveThreadState = {
  events: [],
  signals: [],
  outputs: new Map(),
  working: false,
  live: false,
}
