import type { Attachment } from '@dltech/atlas-core'

import type { LiveSend } from '@/features/threads/data/live-thread-view'

type HeldMessage = {
  text: string
  sendId: string
  attachments?: Attachment[]
}

const held = new Map<string, HeldMessage>()

export const holdFirstMessage = (args: { threadId: string } & HeldMessage): void => {
  const { threadId, ...message } = args
  held.set(threadId, message)
}

export function deliverHeldFirstMessage(args: { threadId: string; send: LiveSend }): boolean {
  const message = held.get(args.threadId)
  if (message === undefined) return false
  const sent = args.send({
    text: message.text,
    requestId: message.sendId,
    ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
  })
  if (sent) held.delete(args.threadId)
  return sent
}
