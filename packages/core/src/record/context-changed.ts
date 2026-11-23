import { z } from 'zod'

export const contextChangedSchema = z.object({
  type: z.literal('context-changed'),
  paths: z.array(z.string().min(1)),
})

export type ContextChanged = {
  type: 'context-changed'
  paths: string[]
}
