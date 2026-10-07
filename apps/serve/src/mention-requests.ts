import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  listMentionFilesParamsSchema,
  mentionFileExistsParamsSchema,
  readMentionFileParamsSchema,
} from '@dltech/atlas-wire'
import type { MentionReader, ThreadStorePort } from '@dltech/atlas-harness'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import { familyThreadIdsOf } from './workspace-hooks'

export const isMentionOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ListMentionFiles ||
  op === EClientRequest.MentionFileExists ||
  op === EClientRequest.ReadMentionFile

export type MentionRouting = {
  files: (threadId: ThreadId) => Promise<MentionReader>
  threads: Pick<ThreadStorePort, 'spawned'>
}

type Asked =
  | { op: EClientRequest.ListMentionFiles; threadId: ThreadId; directory: string }
  | { op: EClientRequest.MentionFileExists | EClientRequest.ReadMentionFile; threadId: ThreadId; path: string }

const askedOf = (frame: RequestFrame): Asked | null => {
  if (frame.op === EClientRequest.ListMentionFiles) {
    const parsed = listMentionFilesParamsSchema.safeParse(frame.params)
    if (!parsed.success) return null
    return { op: frame.op, threadId: toThreadId(parsed.data.threadId), directory: parsed.data.directory }
  }
  const schema =
    frame.op === EClientRequest.MentionFileExists ? mentionFileExistsParamsSchema : readMentionFileParamsSchema
  const parsed = schema.safeParse(frame.params)
  if (!parsed.success) return null
  if (frame.op !== EClientRequest.MentionFileExists && frame.op !== EClientRequest.ReadMentionFile) return null
  return { op: frame.op, threadId: toThreadId(parsed.data.threadId), path: parsed.data.path }
}

export async function answerMentionRead(args: {
  frame: RequestFrame
  root: ThreadId
  mentions: MentionRouting
}): Promise<ReplyFrame> {
  const { frame, root, mentions } = args
  const replyTo = frame.id

  const asked = askedOf(frame)
  if (asked === null) {
    return refusedRequest({ replyTo, message: `${frame.op} wants { threadId, directory | path }` })
  }

  const family = await familyThreadIdsOf({ root, threads: mentions.threads })
  if (!family.has(asked.threadId)) {
    return refusedRequest({ replyTo, message: `thread ${asked.threadId} does not belong to this session` })
  }

  const files = await mentions.files(asked.threadId)
  if (asked.op === EClientRequest.ListMentionFiles) {
    return answeredRequest({ replyTo, data: { entries: await files.list(asked.directory) } })
  }
  if (asked.op === EClientRequest.MentionFileExists) {
    return answeredRequest({ replyTo, data: { exists: await files.exists(asked.path) } })
  }
  return answeredRequest({ replyTo, data: { file: await files.load(asked.path) } })
}

export function routeMentionRead(args: {
  frame: RequestFrame
  root: ThreadId
  mentions: MentionRouting | undefined
  reply: (frame: ReplyFrame) => void
}): boolean {
  const { frame, mentions, reply } = args
  if (!isMentionOp(frame.op)) return false
  if (mentions === undefined) {
    reply(refusedRequest({ replyTo: frame.id, message: 'this serve cannot read mentioned files' }))
    return true
  }
  void answerMentionRead({ frame, root: args.root, mentions })
    .then(reply)
    .catch((error: unknown) =>
      reply(refusedRequest({ replyTo: frame.id, message: error instanceof Error ? error.message : 'the mention read failed' })),
    )
  return true
}
