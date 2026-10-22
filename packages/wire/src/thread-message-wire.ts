import { z } from 'zod'

export enum EThreadMessageState {
  Delivered = 'delivered',
  Queued = 'queued',
}

export const threadMessageRequestSchema = z.object({
  sendId: z.string().min(1).max(200),
  text: z.string().min(1).max(100_000),
})
export type ThreadMessageRequest = z.infer<typeof threadMessageRequestSchema>

export const threadMessageReplySchema = z.object({
  state: z.enum(EThreadMessageState),
  error: z.string().optional(),
})
export type ThreadMessageReply = z.infer<typeof threadMessageReplySchema>

export const threadMessagePath = (threadId: string): string =>
  `/v1/threads/${encodeURIComponent(threadId)}/messages`

export const threadMessageTakeBackPath = (args: { threadId: string; sendId: string }): string =>
  `${threadMessagePath(args.threadId)}/${encodeURIComponent(args.sendId)}`
