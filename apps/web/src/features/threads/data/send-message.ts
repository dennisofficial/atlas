import type { EThreadMessageState, SaidImageWire } from '@dltech/atlas-wire/web'

import { imagesFieldOf } from './composer-images'
import type { LiveSend } from './live-thread-view'
import { postMessage } from './threads-api'

export async function sendMessage(args: {
  threadId: string
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
}): Promise<EThreadMessageState> {
  const { images, ...message } = args
  const reply = await postMessage({ ...message, ...imagesFieldOf(images) })
  return reply.state
}

export async function deliverMessage(args: {
  threadId: string
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
  liveSend: LiveSend
}): Promise<void> {
  const { liveSend, ...message } = args
  const live = { text: message.text, requestId: message.sendId, ...imagesFieldOf(message.images) }
  if (liveSend(live)) return
  await sendMessage(message)
}
