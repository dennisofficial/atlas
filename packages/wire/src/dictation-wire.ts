import { z } from 'zod'

export const DICTATION_MODEL = 'microsoft/mai-transcribe-2-streaming'

export const dictationTokenInputSchema = z.strictObject({})
export type DictationTokenInput = z.infer<typeof dictationTokenInputSchema>

export const dictationTokenReplySchema = z.object({
  token: z.string().min(1),
  url: z.url(),
  model: z.string().min(1),
})
export type DictationTokenReply = z.infer<typeof dictationTokenReplySchema>
