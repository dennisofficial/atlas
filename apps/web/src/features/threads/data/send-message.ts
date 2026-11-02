import type { SaidUpload } from '@dltech/atlas-core'
import type { SaidImageWire, ThreadMessageReply } from '@dltech/atlas-wire/web'

import { uploadsFieldOf } from './composer-attachments'
import { imagesFieldOf } from './composer-images'
import type { LiveSend } from './live-thread-view'
import { postMessage } from './threads-api'

export const SEND_DEADLINE_MS = 30_000
export const SEND_TIMED_OUT =
  "Atlas Cloud didn't confirm the message in time. It's still in the composer — send it again to retry."

export function withDeadline<T>(args: {
  ms: number
  message: string
  run: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(args.message))
      controller.abort()
    }, args.ms)
    args
      .run(controller.signal)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer))
  })
}

export async function sendMessage(args: {
  threadId: string
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
  uploads?: SaidUpload[] | undefined
  post?: typeof postMessage | undefined
  deadlineMs?: number | undefined
}): Promise<ThreadMessageReply> {
  const { images, uploads, post = postMessage, deadlineMs = SEND_DEADLINE_MS, ...message } = args
  return withDeadline({
    ms: deadlineMs,
    message: SEND_TIMED_OUT,
    run: (signal) =>
      post({
        ...message,
        ...imagesFieldOf(images),
        ...uploadsFieldOf(uploads),
        signal,
      }),
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
  deadlineMs?: number | undefined
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
