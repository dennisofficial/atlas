import type { EThreadMessageState } from '@dltech/atlas-wire/web'

import type { LiveSend } from './live-thread-view'
import { postMessage } from './threads-api'

export async function sendMessage(args: {
  threadId: string
  text: string
  sendId: string
}): Promise<EThreadMessageState> {
  const reply = await postMessage(args)
  return reply.state
}

export async function deliverMessage(args: {
  threadId: string
  text: string
  sendId: string
  liveSend: LiveSend
}): Promise<void> {
  const { liveSend, ...message } = args
  if (liveSend({ text: message.text, requestId: message.sendId })) return
  await sendMessage(message)
}
