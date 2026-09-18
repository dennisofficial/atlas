import { z } from 'zod'

import { browseCandidates, splitMentionQuery } from '@dltech/atlas-core'

import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../cloud/channel-wire'
import type { FileBrowser } from '../files/file-browser'
import { captureWorkspace } from '../workspace/snapshot'

export const MAX_COMPLETIONS = 50

export type RequestFrame = Extract<ClientFrame, { kind: EClientFrame.Request }>

export type ReplyFrame = Extract<ServeFrame, { kind: EServeFrame.Reply }>

const completePathsSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(MAX_COMPLETIONS).optional(),
})

const browseDirectorySchema = z.object({ directory: z.string() })

const captureWorkspaceSchema = z.object({ cwd: z.string() })

const refused = (args: { replyTo: string; message: string }): ReplyFrame => ({
  kind: EServeFrame.Reply,
  replyTo: args.replyTo,
  ok: false,
  data: { message: args.message },
})

const answered = (args: { replyTo: string; data: unknown }): ReplyFrame => ({
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
    return refused({ replyTo: args.frame.id, message: 'complete-paths wants { query, limit? }' })
  }

  const { directory, fragment } = splitMentionQuery(parsed.data.query)
  const entries = await args.files.list(directory)
  const matches = browseCandidates({ entries, fragment }).slice(
    0,
    parsed.data.limit ?? MAX_COMPLETIONS,
  )

  return answered({ replyTo: args.frame.id, data: { directory, fragment, entries: matches } })
}

async function browseDirectory(args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'list'>
}): Promise<ReplyFrame> {
  const parsed = browseDirectorySchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refused({ replyTo: args.frame.id, message: 'browse-directory wants { directory }' })
  }

  const entries = await args.files.list(parsed.data.directory)
  return answered({ replyTo: args.frame.id, data: { directory: parsed.data.directory, entries } })
}

async function captureWorkspaceHandler(args: { frame: RequestFrame }): Promise<ReplyFrame> {
  const parsed = captureWorkspaceSchema.safeParse(args.frame.params)
  if (!parsed.success) {
    return refused({ replyTo: args.frame.id, message: 'capture-workspace wants { cwd }' })
  }

  const snapshot = await captureWorkspace({ cwd: parsed.data.cwd })
  return answered({ replyTo: args.frame.id, data: snapshot })
}

export async function answerRequest(args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'list'>
}): Promise<ReplyFrame> {
  if (args.frame.op === EClientRequest.CompletePaths) return await completePaths(args)
  if (args.frame.op === EClientRequest.BrowseDirectory) return await browseDirectory(args)
  return await captureWorkspaceHandler(args)
}
