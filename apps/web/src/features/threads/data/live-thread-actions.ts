import {
  EClientRequest,
  EConnectionView,
  requestRewindApply,
  type RemoteDeltaChannel,
} from '@dltech/atlas-client/channel'
import { toThreadId } from '@dltech/atlas-core'
import { rosterWireSchema, takeBackPendingReplySchema } from '@dltech/atlas-wire/web'

import type {
  LiveApplyRewind,
  LiveChooseModel,
  LiveInterrupt,
  LiveReadRoster,
  LiveRetry,
  LiveTakeBackPending,
} from './live-thread-view'

export function createLiveThreadActions(args: {
  threadId: string
  liveChannel: () => RemoteDeltaChannel | null
  onModelChosen: () => void
}): {
  chooseModel: LiveChooseModel
  takeBackPending: LiveTakeBackPending
  interrupt: LiveInterrupt
  retry: LiveRetry
  applyRewind: LiveApplyRewind
  readRoster: LiveReadRoster
} {
  const connected = (): RemoteDeltaChannel | null => {
    const live = args.liveChannel()
    if (live === null) return null
    if (live.connection().state !== EConnectionView.Connected) return null
    return live
  }

  const chooseModel: LiveChooseModel = async (model) => {
    args.onModelChosen()
    const live = connected()
    if (live === null) return false
    await live.request({
      op: EClientRequest.SetThreadModel,
      params: { threadId: args.threadId, model },
    })
    return true
  }

  const takeBackPending: LiveTakeBackPending = async () => {
    const live = connected()
    if (live === null) throw new Error('the sandbox is not connected')
    const reply = await live.request({
      op: EClientRequest.TakeBackPending,
      params: { threadId: args.threadId },
    })
    const taken = takeBackPendingReplySchema.parse(reply).taken
    if (taken === null) return null
    return { text: taken.text, images: taken.images, uploads: taken.uploads ?? [] }
  }

  const interrupt: LiveInterrupt = () => {
    const live = connected()
    if (live === null) return false
    live.interrupt()
    return true
  }

  const retry: LiveRetry = () => {
    const live = connected()
    if (live === null) return false
    live.run()
    return true
  }

  const applyRewind: LiveApplyRewind = async ({ cuts, toSeq }) => {
    const live = connected()
    if (live === null) throw new Error('the sandbox is not connected')
    await requestRewindApply({
      channel: live,
      params: { threadId: toThreadId(args.threadId), cuts: [...cuts], toSeq },
    })
  }

  const readRoster: LiveReadRoster = async () => {
    const live = connected()
    if (live === null) return null
    try {
      return rosterWireSchema.parse(
        await live.request({ op: EClientRequest.ListRoster, params: {} }),
      )
    } catch {
      return null
    }
  }

  return { chooseModel, takeBackPending, interrupt, retry, applyRewind, readRoster }
}
