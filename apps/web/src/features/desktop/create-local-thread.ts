import type { Attachment } from '@dltech/atlas-core'

import { createLocalPod } from './desktop-wire'
import { holdFirstMessage } from './first-message'

export const newLocalThreadId = (): string => `brn_${crypto.randomUUID()}`

export async function createLocalThread(args: {
  threadId: string
  projectId: string
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
  text: string
  sendId: string
  attachments?: Attachment[] | undefined
}): Promise<string> {
  const { threadId, projectId, model, effort, fast, text, sendId, attachments } = args
  await createLocalPod({
    threadId,
    projectId,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(fast === undefined ? {} : { fast }),
  })
  holdFirstMessage({
    threadId,
    text,
    sendId,
    ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
  })
  return threadId
}
