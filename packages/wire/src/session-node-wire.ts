import { z } from 'zod'

import { wireThreadSchema, type WireThread } from './session-wire'

export type WireSessionNode = {
  id: string
  mainThread: WireThread
  teammates: WireSessionNode[]
}

export const wireSessionNodeSchema: z.ZodType<WireSessionNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    mainThread: wireThreadSchema,
    teammates: z.array(wireSessionNodeSchema),
  }),
)

export const sessionsListInputSchema = z.strictObject({ projectId: z.string().nullable() })
export type SessionsListInput = z.infer<typeof sessionsListInputSchema>
