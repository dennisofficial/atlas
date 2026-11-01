import { z } from 'zod'

export const podConnectReplySchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  /** The pod's root thread — what the serve answers Hello and tickets for. */
  threadId: z.string().min(1),
})
export type PodConnectReply = z.infer<typeof podConnectReplySchema>
