import type { SaidUpload } from '@dltech/atlas-core'
import type { EThreadMessageState, SaidImageWire } from '@dltech/atlas-wire/web'

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
}): Promise<EThreadMessageState> {
  const { images, uploads, ...message } = args
  const reply = await postMessage({
    ...message,
    ...imagesFieldOf(images),
    ...uploadsFieldOf(uploads),
  })
  return reply.state
}

export async function deliverMessage(args: {
  threadId: string
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
  uploads?: SaidUpload[] | undefined
  liveSend: LiveSend
}): Promise<void> {
  const { liveSend, ...message } = args
  const live = {
    text: message.text,
    requestId: message.sendId,
    ...imagesFieldOf(message.images),
    ...uploadsFieldOf(message.uploads),
  }
  if (liveSend(live)) return
  await sendMessage(message)
}
