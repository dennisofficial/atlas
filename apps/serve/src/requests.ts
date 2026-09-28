import { z } from 'zod'

import {
  browseCandidates,
  splitMentionQuery,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  readEventsParamsSchema,
  readThreadParamsSchema,
  readTurnsParamsSchema,
  renameThreadParamsSchema,
  setThreadModelParamsSchema,
  type ClientFrame,
  type ServeFrame,
} from '@dltech/atlas-harness'
import type { FileBrowser } from '@dltech/atlas-harness'
import type { TurnLedgerPort } from '@dltech/atlas-harness'
import type { ThreadStorePort } from '@dltech/atlas-harness'

import type { WorkspacePublisher } from './publish-workspace'
import { wireEventOf, wireThreadOf, wireTurnOf } from './session-wires'

export const MAX_COMPLETIONS = 50

export type RequestFrame = Extract<ClientFrame, { kind: EClientFrame.Request }>

export type ReplyFrame = Extract<ServeFrame, { kind: EServeFrame.Reply }>

const completePathsSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(MAX_COMPLETIONS).optional(),
})

const browseDirectorySchema = z.object({ directory: z.string() })

export const refusedRequest = (args: { replyTo: string; message: string }): ReplyFrame => ({
  kind: EServeFrame.Reply,
  replyTo: args.replyTo,
  ok: false,
  data: { message: args.message },
})

export const answeredRequest = (args: { replyTo: string; data: unknown }): ReplyFrame => ({
  kind: EServeFrame.Reply,
  replyTo: args.replyTo,
  ok: true,
  data: args.data,
})

async function completePaths(args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'list'>
}): Promise<ReplyFrame> {
  const parsed = completePathsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo: args.frame.id, message: 'complete-paths wants { query, limit? }' })
  }

  const { directory, fragment } = splitMentionQuery(parsed.data.query)
  const entries = await args.files.list(directory)
  const matches = browseCandidates({ entries, fragment }).slice(
    0,
    parsed.data.limit ?? MAX_COMPLETIONS,
  )

  return answeredRequest({ replyTo: args.frame.id, data: { directory, fragment, entries: matches } })
}

async function browseDirectory(args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'list'>
}): Promise<ReplyFrame> {
  const parsed = browseDirectorySchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo: args.frame.id, message: 'browse-directory wants { directory }' })
  }

  const entries = await args.files.list(parsed.data.directory)
  return answeredRequest({ replyTo: args.frame.id, data: { directory: parsed.data.directory, entries } })
}

async function publishWorkspaceHandler(args: {
  frame: RequestFrame
  publish: WorkspacePublisher
}): Promise<ReplyFrame> {
  const published = await args.publish()
  return answeredRequest({ replyTo: args.frame.id, data: published })
}

export async function answerRequest(args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'list'>
  publish: WorkspacePublisher
}): Promise<ReplyFrame> {
  if (args.frame.op === EClientRequest.CompletePaths) return await completePaths(args)
  if (args.frame.op === EClientRequest.BrowseDirectory) return await browseDirectory(args)
  if (args.frame.op === EClientRequest.PublishWorkspace) return await publishWorkspaceHandler(args)
  return refusedRequest({ replyTo: args.frame.id, message: `unknown request op: ${args.frame.op}` })
}

export type TranscriptReaders = {
  log: Pick<EventLogPort, 'read' | 'readOwn'>
  threads: Pick<ThreadStorePort, 'find' | 'spawned' | 'rename' | 'chooseModel'>
  ledger: Pick<TurnLedgerPort, 'forThreadTree'>
}

/** The transcript ops that mutate the served session's stores rather than reading them. */
export const isTranscriptWriteOp = (op: EClientRequest): boolean =>
  op === EClientRequest.RenameThread || op === EClientRequest.SetThreadModel

export async function answerRenameThread(args: {
  frame: RequestFrame
  transcript: TranscriptReaders
}): Promise<ReplyFrame> {
  const parsed = renameThreadParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'rename-thread wants { threadId, title }',
    })
  }
  await args.transcript.threads.rename({
    threadId: parsed.data.threadId as ThreadId,
    title: parsed.data.title,
  })
  return answeredRequest({
    replyTo: args.frame.id,
    data: { threadId: parsed.data.threadId, title: parsed.data.title },
  })
}

export async function answerSetThreadModel(args: {
  frame: RequestFrame
  transcript: TranscriptReaders
  /** Re-pins the running loop's model; absent in a fake, where the pick is only recorded. */
  select?: ((model: { ref: string; effort: string }) => void) | undefined
}): Promise<ReplyFrame> {
  const parsed = setThreadModelParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: 'set-thread-model wants { threadId, model: { ref, effort } }',
    })
  }
  await args.transcript.threads.chooseModel({
    threadId: parsed.data.threadId as ThreadId,
    model: parsed.data.model,
  })
  args.select?.(parsed.data.model)
  return answeredRequest({
    replyTo: args.frame.id,
    data: { threadId: parsed.data.threadId, model: parsed.data.model },
  })
}

export async function answerTranscriptWrite(args: {
  frame: RequestFrame
  transcript: TranscriptReaders
  select?: ((model: { ref: string; effort: string }) => void) | undefined
}): Promise<ReplyFrame> {
  if (args.frame.op === EClientRequest.RenameThread) return await answerRenameThread(args)
  return await answerSetThreadModel(args)
}

/** The ops that read the served session's transcript; anything else is answered by `answerRequest`. */
export const isTranscriptReadOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ReadEvents ||
  op === EClientRequest.ReadThread ||
  op === EClientRequest.ReadThreads ||
  op === EClientRequest.ReadTurns

export async function answerTranscriptRead(args: {
  frame: RequestFrame
  transcript: TranscriptReaders
  threadId: ThreadId
}): Promise<ReplyFrame> {
  if (args.frame.op === EClientRequest.ReadEvents) {
    const parsed = readEventsParamsSchema.safeParse(args.frame.params)
    if (!parsed.success) {
      return refusedRequest({
        replyTo: args.frame.id,
        message: 'read-events wants { threadId, fromSeq?, upTo?, own? }',
      })
    }
    const { threadId, fromSeq, upTo, own } = parsed.data
    const readArgs = {
      threadId: threadId as ThreadId,
      ...(fromSeq === undefined ? {} : { fromSeq }),
      ...(upTo === undefined ? {} : { upTo }),
    }
    const events = own === true ? await args.transcript.log.readOwn(readArgs) : await args.transcript.log.read(readArgs)
    return answeredRequest({
      replyTo: args.frame.id,
      data: { events: events.map(wireEventOf) },
    })
  }

  if (args.frame.op === EClientRequest.ReadThreads) {
    const root = await args.transcript.threads.find({ threadId: args.threadId })
    const children = await args.transcript.threads.spawned({ threadId: args.threadId })
    return answeredRequest({
      replyTo: args.frame.id,
      data: {
        threads: [...(root === undefined ? [] : [root]), ...children].map(wireThreadOf),
      },
    })
  }

  if (args.frame.op === EClientRequest.ReadThread) {
    const parsed = readThreadParamsSchema.safeParse(args.frame.params)
    if (!parsed.success) {
      return refusedRequest({ replyTo: args.frame.id, message: 'read-thread wants { threadId }' })
    }
    const thread = await args.transcript.threads.find({ threadId: parsed.data.threadId as ThreadId })
    return answeredRequest({
      replyTo: args.frame.id,
      data: { thread: thread === undefined ? null : wireThreadOf(thread) },
    })
  }

  const parsed = readTurnsParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo: args.frame.id, message: 'read-turns wants { threadId }' })
  }
  const tree = await args.transcript.ledger.forThreadTree({ threadId: parsed.data.threadId as ThreadId })
  return answeredRequest({
    replyTo: args.frame.id,
    data: { own: tree.own.map(wireTurnOf), delegated: tree.delegated.map(wireTurnOf) },
  })
}
