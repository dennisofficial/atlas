import { z } from 'zod'

import {
  browseCandidates,
  splitMentionQuery,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  EClientRequest,
  readEventsParamsSchema,
  readThreadParamsSchema,
  readTranscriptIdentityParamsSchema,
  readTurnsParamsSchema,
  takeBackPendingParamsSchema,
  transcriptIdentityDigest,
  renameThreadParamsSchema,
} from '@dltech/atlas-harness'
import type { FileBrowser, PendingQueues } from '@dltech/atlas-harness'
import type { TurnLedgerPort } from '@dltech/atlas-harness'
import type { ThreadStorePort } from '@dltech/atlas-harness'

import { wireEventOf, wireThreadOf, wireTurnOf } from './session-wires'
import { answerSetThreadModel } from './thread-model'
import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'

export { answerSetThreadModel } from './thread-model'

export const MAX_COMPLETIONS = 50

const completePathsSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(MAX_COMPLETIONS).optional(),
})

const browseDirectorySchema = z.object({ directory: z.string() })

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

export async function answerRequest(args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'list'>
}): Promise<ReplyFrame> {
  if (args.frame.op === EClientRequest.CompletePaths) return await completePaths(args)
  if (args.frame.op === EClientRequest.BrowseDirectory) return await browseDirectory(args)
  return refusedRequest({ replyTo: args.frame.id, message: `unknown request op: ${args.frame.op}` })
}

export type TranscriptReaders = {
  log: Pick<EventLogPort, 'read' | 'readOwn'>
  threads: Pick<ThreadStorePort, 'find' | 'spawned' | 'rename' | 'chooseModel'>
  ledger: Pick<TurnLedgerPort, 'forThreadTree'>
}

export const pendingEntriesOf = (args: { pending: PendingQueues; threadId: ThreadId }) => {
  const queue = args.pending.forThread({ threadId: args.threadId })
  return queue.getSnapshot().map((entry) => ({
    id: entry.id,
    text: entry.text,
    ...(entry.kind === 'message' && entry.via !== undefined ? { via: entry.via as string } : {}),
    reserved: queue.reserved(entry.id),
  }))
}

export const isPendingOp = (op: EClientRequest): boolean => op === EClientRequest.TakeBackPending

export async function answerTakeBackPending(args: {
  frame: RequestFrame
  pending: PendingQueues
}): Promise<ReplyFrame> {
  const parsed = takeBackPendingParamsSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo: args.frame.id, message: 'take-back-pending wants { threadId }' })
  }
  const said = args.pending.forThread({ threadId: parsed.data.threadId as ThreadId }).takeBackLast()
  if (said === null) return answeredRequest({ replyTo: args.frame.id, data: { taken: null } })
  const { text, images, files, context } = said
  return answeredRequest({
    replyTo: args.frame.id,
    data: { taken: { text, images, files, ...(context === undefined ? {} : { context }) } },
  })
}

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

export async function answerTranscriptWrite(args: {
  frame: RequestFrame
  transcript: TranscriptReaders
  threadId: ThreadId
  select?: ((model: { ref: string; effort: string }) => void) | undefined
}): Promise<ReplyFrame> {
  if (args.frame.op === EClientRequest.RenameThread) return await answerRenameThread(args)
  return await answerSetThreadModel(args)
}

export const isTranscriptReadOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ReadEvents ||
  op === EClientRequest.ReadThread ||
  op === EClientRequest.ReadThreads ||
  op === EClientRequest.ReadTranscriptIdentity ||
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

  if (args.frame.op === EClientRequest.ReadTranscriptIdentity) {
    const parsed = readTranscriptIdentityParamsSchema.safeParse(args.frame.params)
    if (!parsed.success) {
      return refusedRequest({
        replyTo: args.frame.id,
        message: 'read-transcript-identity wants { threadId, upTo? }',
      })
    }
    const { threadId, upTo } = parsed.data
    const readArgs = {
      threadId: threadId as ThreadId,
      ...(upTo === undefined ? {} : { upTo }),
    }
    const events = await args.transcript.log.readOwn(readArgs)
    return answeredRequest({
      replyTo: args.frame.id,
      data: { count: events.length, digest: transcriptIdentityDigest(events) },
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
