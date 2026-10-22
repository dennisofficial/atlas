import type { EThreadMessageState } from '@dltech/atlas-wire/web'

import { postMessage } from './threads-api'

export async function sendMessage(args: {
  threadId: string
  text: string
  sendId: string
}): Promise<EThreadMessageState> {
  const reply = await postMessage(args)
  return reply.state
}
