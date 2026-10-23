import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  setThreadModelParamsSchema,
  type ThreadStorePort,
  type ThreadSummary,
} from '@dltech/atlas-harness'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'
import type { TranscriptReaders } from './requests'
import { EServeEvent, type ServeLog } from './serve-log'

async function belongsToServedSession(args: {
  threads: Pick<ThreadStorePort, 'find'>
  target: ThreadSummary
  servedId: ThreadId
}): Promise<boolean> {
  const visited = new Set<ThreadId>()
  let thread: ThreadSummary | undefined = args.target
  while (thread !== undefined) {
    if (thread.id === args.servedId) return true
    if (visited.has(thread.id) || thread.agent === undefined) return false
    visited.add(thread.id)
    thread = await args.threads.find({ threadId: thread.agent.spawnedBy })
  }
  return false
}

async function persistRootModel(args: {
  persist: ((model: { ref: string; effort: string }) => Promise<void>) | undefined
  log: ServeLog | undefined
  threadId: ThreadId
  model: { ref: string; effort: string }
}): Promise<void> {
  try {
    await args.persist?.(args.model)
  } catch (failure) {
    args.log?.({
      event: EServeEvent.ThreadModelPersistFailed,
      threadId: args.threadId,
      message: failure instanceof Error ? failure.message : String(failure),
    })
  }
}

export async function answerSetThreadModel(args: {
  frame: RequestFrame
  transcript: TranscriptReaders
  threadId: ThreadId
  select?: ((model: { ref: string; effort: string }) => void) | undefined
  persist?: ((model: { ref: string; effort: string }) => Promise<void>) | undefined
  log?: ServeLog | undefined
}): Promise<ReplyFrame> {
  const parsed = setThreadModelParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'set-thread-model wants { threadId, model: { ref, effort }, retarget?: boolean }',
    })
  }
  const { model, retarget } = parsed.data
  const served = await args.transcript.threads.find({ threadId: args.threadId })
  if (served?.agent !== undefined) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'a supervised agent runs the model it was spawned with',
    })
  }
  const threadId = toThreadId(parsed.data.threadId)
  const target =
    threadId === args.threadId ? served : await args.transcript.threads.find({ threadId })
  if (
    served === undefined ||
    target === undefined ||
    target.id !== threadId ||
    !(await belongsToServedSession({
      threads: args.transcript.threads,
      target,
      servedId: args.threadId,
    }))
  ) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'the model target does not belong to this served session',
    })
  }
  if (target.agent !== undefined && retarget !== true) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'a supervised agent needs an explicit operator retarget to change its model',
    })
  }
  await args.transcript.threads.chooseModel({
    threadId,
    model,
    ...(retarget === undefined ? {} : { retarget }),
  })
  if (target.agent === undefined && threadId === args.threadId) {
    args.select?.(model)
    await persistRootModel({ persist: args.persist, log: args.log, threadId, model })
  }
  return answeredRequest({ replyTo: args.frame.id, data: { threadId, model } })
}
