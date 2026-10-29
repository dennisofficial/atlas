import type { SaidImageWire } from '@dltech/atlas-wire/web'

import type { LiveSend } from '@/features/threads/data/live-thread-view'

type HeldMessage = { text: string; sendId: string; images?: SaidImageWire[] }

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
    ...(message.images === undefined ? {} : { images: message.images }),
  })
  if (sent) held.delete(args.threadId)
  return sent
}
