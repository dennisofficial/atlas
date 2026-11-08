import type { Attachment } from '@dltech/atlas-core'
import type { ThreadMessageReply } from '@dltech/atlas-wire/web'

import { attachmentsFieldOf } from './composer-attachments'
import type { LiveSend } from './live-thread-view'
import { postMessage } from './threads-api'

export async function sendMessage(args: {
  threadId: string
  text: string
  sendId: string
  attachments?: Attachment[] | undefined
  post?: typeof postMessage | undefined
}): Promise<ThreadMessageReply> {
  const { attachments, post = postMessage, ...message } = args
  return post({
    ...message,
    ...attachmentsFieldOf(attachments),
  })
}

export async function deliverMessage(args: {
  threadId: string
  text: string
  sendId: string
  attachments?: Attachment[] | undefined
  liveSend: LiveSend
  post?: typeof postMessage | undefined
}): Promise<void> {
  const { liveSend, ...message } = args
  const live = {
    text: message.text,
    requestId: message.sendId,
    ...attachmentsFieldOf(message.attachments),
  }
  if (liveSend(live)) return
  const reply = await sendMessage(message)
  if (reply.error !== undefined) throw new Error(reply.error)
}
