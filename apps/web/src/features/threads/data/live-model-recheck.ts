import { EClientRequest, type RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { readThreadReplySchema } from '@dltech/atlas-wire/web'

import type { ThreadModelChoice } from './live-thread-view'

export type ModelRecheckArgs = {
  threadId: string
  readStoredModel?: (() => Promise<ThreadModelChoice | undefined>) | undefined
  stale: () => boolean
  choices: () => number
}

/**
 * Re-pins the pod's model to the stored choice when the pod drifted — a rotation or a restart
 * replays the serve's own store, and the cloud thread row is the one the next boot reads.
 */
export async function recheckPodModel(
  live: RemoteDeltaChannel,
  args: ModelRecheckArgs,
): Promise<void> {
  const read = args.readStoredModel
  if (read === undefined) return
  try {
    const choicesBefore = args.choices()
    const stored = await read()
    if (stored === undefined) return
    const reply = await live.request({
      op: EClientRequest.ReadThread,
      params: { threadId: args.threadId },
    })
    const podModel = readThreadReplySchema.parse(reply).thread?.model
    if (args.stale() || args.choices() !== choicesBefore || podModel === undefined) return
    if (podModel.ref === stored.ref && podModel.effort === stored.effort) return
    await live.request({
      op: EClientRequest.SetThreadModel,
      params: { threadId: args.threadId, model: stored },
    })
  } catch {
    return
  }
}
