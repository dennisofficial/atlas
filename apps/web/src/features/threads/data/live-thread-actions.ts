import {
  EClientRequest,
  EConnectionView,
  type RemoteDeltaChannel,
} from '@dltech/atlas-client/channel'
import { takeBackPendingReplySchema } from '@dltech/atlas-wire/web'

import type { LiveChooseModel, LiveInterrupt, LiveTakeBackPending } from './live-thread-view'

export function createLiveThreadActions(args: {
  threadId: string
  liveChannel: () => RemoteDeltaChannel | null
  onModelChosen: () => void
}): {
  chooseModel: LiveChooseModel
  takeBackPending: LiveTakeBackPending
  interrupt: LiveInterrupt
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
    return takeBackPendingReplySchema.parse(reply).taken?.text ?? null
  }

  const interrupt: LiveInterrupt = () => {
    const live = connected()
    if (live === null) return false
    live.interrupt()
    return true
  }

  return { chooseModel, takeBackPending, interrupt }
}
