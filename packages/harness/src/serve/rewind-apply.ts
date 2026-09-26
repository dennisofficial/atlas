import {
  EKilledBy,
  type ThreadId,
} from '@dltech/atlas-core'
import { rewindApplyParamsSchema, type RewindCutWire } from '@dltech/atlas-wire'

import type { ThreadStorePort } from '../store/thread-store'

import type { ReplyFrame, RequestFrame } from './requests'
import { answeredRequest, refusedRequest } from './requests'
import type { ServeTurnDriver } from './turn-driver'

/**
 * The sandbox's half of a confirmed rewind: the named creations are removed from the real
 * registries (running ones are killed first, as `removeShells`/`removeServices`/`removeChildren`
 * already do), and a turn in flight is interrupted so its next step reads the truncated log
 * rather than acting on pre-rewind state. The durable truncation itself already landed over HTTP
 * before this frame was sent — nothing here writes the log.
 */
export type ServeRewindTarget = {
  removeChildren(args: { threadId: ThreadId; agentIds: readonly ThreadId[] }): Promise<void>
  removeShells(args: { threadId: ThreadId; shellIds: readonly string[]; by: EKilledBy }): void
  removeServices(args: { serviceIds: readonly string[]; by: EKilledBy }): void
}

/**
 * The transcript half of a confirmed rewind, present only on a serve whose durable log is its own
 * disk. The serve truncates it here, in the same apply that kills the cut processes, so the kill
 * and the truncation are one request rather than a write racing a command.
 */
export type ServeRewindLog = {
  truncate(args: { threadId: ThreadId; toSeq: number; cutAgents: readonly ThreadId[] }): Promise<void>
}

export async function answerRewind(args: {
  frame: RequestFrame
  threadId: ThreadId
  target: ServeRewindTarget
  driver: Pick<ServeTurnDriver, 'interrupt'>
  /** The durable truncation, answered only by a serve whose transcript is on its own disk. */
  truncate?: ServeRewindLog | undefined
}): Promise<ReplyFrame> {
  const parsed = rewindApplyParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'rewind wants { threadId, cuts, toSeq? }',
    })
  }

  if (parsed.data.threadId !== args.threadId) {
    return refusedRequest({ replyTo: args.frame.id, message: 'this sandbox serves one thread' })
  }

  const cuts: readonly RewindCutWire[] = parsed.data.cuts
  const agentIds = cuts.flatMap((cut) => (cut.kind === 'agent' ? [cut.agentId] : []))
  const shellIds = cuts.flatMap((cut) => (cut.kind === 'shell' ? [cut.shellId] : []))
  const serviceIds = cuts.flatMap((cut) => (cut.kind === 'service' ? [cut.serviceId] : []))

  await args.target.removeChildren({ threadId: args.threadId, agentIds })
  args.target.removeShells({ threadId: args.threadId, shellIds, by: EKilledBy.Rewind })
  args.target.removeServices({ serviceIds, by: EKilledBy.Rewind })

  const toSeq = parsed.data.toSeq
  if (toSeq !== undefined && args.truncate !== undefined) {
    await args.truncate.truncate({ threadId: args.threadId, toSeq, cutAgents: agentIds })
  }

  args.driver.interrupt()

  return answeredRequest({ replyTo: args.frame.id, data: { applied: cuts.length } })
}
