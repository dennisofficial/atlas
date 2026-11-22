import { z } from 'zod'

import { createThreadMemory } from '@/features/threads/panel/thread-memory'

export const CHECKOUT_MEMORY_KEY = 'atlas:session-checkout'

const checkoutMemorySchema = z.object({
  checkoutId: z.string().optional(),
})

const memories = createThreadMemory({ key: CHECKOUT_MEMORY_KEY, schema: checkoutMemorySchema })

export const recallCheckout = (sessionId: string): string | undefined =>
  memories.recall(sessionId)?.checkoutId

export function rememberCheckout(args: { sessionId: string; checkoutId: string }): void {
  memories.remember({ threadId: args.sessionId, memory: { checkoutId: args.checkoutId } })
}
