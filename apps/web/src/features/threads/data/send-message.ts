import type { SaidUpload } from '@dltech/atlas-core'
import type { SaidImageWire, ThreadMessageReply } from '@dltech/atlas-wire/web'

import { uploadsFieldOf } from './composer-attachments'
import { imagesFieldOf } from './composer-images'
import type { LiveSend } from './live-thread-view'
import { postMessage } from './threads-api'

export async function sendMessage(args: {
  threadId: string
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
  uploads?: SaidUpload[] | undefined
  post?: typeof postMessage | undefined
}): Promise<ThreadMessageReply> {
  const { images, uploads, post = postMessage, ...message } = args
  return post({
    ...message,
    ...imagesFieldOf(images),
    ...uploadsFieldOf(uploads),
  })
}

export async function deliverMessage(args: {
  threadId: string
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
  uploads?: SaidUpload[] | undefined
  liveSend: LiveSend
  post?: typeof postMessage | undefined
}): Promise<void> {
  const { liveSend, ...message } = args
  const live = {
    text: message.text,
    requestId: message.sendId,
    ...imagesFieldOf(message.images),
    ...uploadsFieldOf(message.uploads),
  }
  if (liveSend(live)) return
  const reply = await sendMessage(message)
  if (reply.error !== undefined) throw new Error(reply.error)
}
