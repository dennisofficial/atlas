import type { SaidImageWire } from '@dltech/atlas-wire/web'

import { createLocalPod } from './desktop-wire'
import { holdFirstMessage } from './first-message'

export const newLocalThreadId = (): string => `brn_${crypto.randomUUID()}`

export async function createLocalThread(args: {
  threadId: string
  projectId: string
  model?: string | undefined
  effort?: string | undefined
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
}): Promise<string> {
  const { threadId, projectId, model, effort, text, sendId, images } = args
  await createLocalPod({
    threadId,
    projectId,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  })
  holdFirstMessage({
    threadId,
    text,
    sendId,
    ...(images === undefined || images.length === 0 ? {} : { images }),
  })
  return threadId
}
