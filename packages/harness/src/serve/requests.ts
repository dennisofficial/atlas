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
  type ClientFrame,
  type ServeFrame,
} from '../cloud/channel-wire'
import type { FileBrowser } from '../files/file-browser'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { ThreadStorePort } from '../store/thread-store'

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
  return await publishWorkspaceHandler(args)
}

export type TranscriptReaders = {
  log: Pick<EventLogPort, 'read' | 'readOwn'>
  threads: Pick<ThreadStorePort, 'find' | 'spawned'>
  ledger: Pick<TurnLedgerPort, 'forThreadTree'>
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
