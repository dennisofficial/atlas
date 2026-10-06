import type { ThreadId } from '@dltech/atlas-core'
import {
  cancelCompactionParamsSchema,
  compactHistoryParamsSchema,
  summariseHistoryParamsSchema,
} from '@dltech/atlas-wire'
import {
  compactScopeFromWire,
  compactionAnchorFromWire,
  compactionToReply,
  EClientRequest,
  ECompaction,
  type CompactionPort,
} from '@dltech/atlas-harness'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import type { ServeTurnDriver } from './turn-driver'

export const isCompactionOp = (op: EClientRequest): boolean =>
  op === EClientRequest.CompactHistory ||
  op === EClientRequest.SummariseHistory ||
  op === EClientRequest.CancelCompaction

export function createCompactionRequests(args: {
  threadId: ThreadId
  compaction: CompactionPort | undefined
  driver: Pick<ServeTurnDriver, 'holdHistory'>
  changed: () => void
}) {
  let active: { operationId: string; controller: AbortController; done: Promise<void> } | undefined

  const answer = async (frame: RequestFrame): Promise<ReplyFrame> => {
    if (frame.op === EClientRequest.CancelCompaction) {
      const parsed = cancelCompactionParamsSchema.safeParse(frame.params)
      if (!parsed.success || parsed.data.threadId !== args.threadId) {
        return refusedRequest({
          replyTo: frame.id,
          message: 'cancel-compaction wants the served thread and operation ID',
        })
      }
      const cancelled = active?.operationId === parsed.data.operationId
      if (cancelled) active?.controller.abort()
      return answeredRequest({ replyTo: frame.id, data: { cancelled } })
    }

    const parsed =
      frame.op === EClientRequest.CompactHistory
        ? compactHistoryParamsSchema.safeParse(frame.params)
        : summariseHistoryParamsSchema.safeParse(frame.params)
    if (!parsed.success)
      return refusedRequest({
        replyTo: frame.id,
        message: 'invalid history compaction request',
      })
    const params = parsed.data
    if (params.threadId !== args.threadId) {
      return refusedRequest({
        replyTo: frame.id,
        message: 'this sandbox serves one thread',
      })
    }
    if (args.compaction === undefined) {
      return refusedRequest({
        replyTo: frame.id,
        message: 'this serve cannot summarise history',
      })
    }

    let release: (() => void) | undefined
    let finish = (): void => undefined
    try {
      release = args.driver.holdHistory()
      const controller = new AbortController()
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      active = { operationId: params.operationId, controller, done }
      const common = { threadId: args.threadId, signal: controller.signal }
      const outcome =
        'scope' in params
          ? await args.compaction.compact({
              ...common,
              scope: compactScopeFromWire(params.scope),
            })
          : await args.compaction.summarise({
              ...common,
              anchor: compactionAnchorFromWire(params.anchor),
              seq: params.seq,
            })
      if (outcome.type === ECompaction.Compacted) args.changed()
      return answeredRequest({
        replyTo: frame.id,
        data: compactionToReply(outcome),
      })
    } catch (error) {
      return refusedRequest({
        replyTo: frame.id,
        message: error instanceof Error ? error.message : 'history compaction failed',
      })
    } finally {
      if (release !== undefined) {
        active = undefined
        release()
        finish()
      }
    }
  }
  const abortAll = (): void => active?.controller.abort()
  const whenSettled = async (): Promise<void> => {
    while (active !== undefined) await active.done
  }
  return { answer, active: () => active !== undefined, abortAll, whenSettled }
}
