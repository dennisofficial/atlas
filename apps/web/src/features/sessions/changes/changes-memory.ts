import { z } from 'zod'

import { createThreadMemory } from '@/features/threads/panel/thread-memory'

export const CHANGES_MEMORY_KEY = 'atlas:session-changes'

const changesMemorySchema = z.object({
  expanded: z.array(z.string()).optional(),
})

export type ChangesMemory = z.infer<typeof changesMemorySchema>

const memories = createThreadMemory({
  key: CHANGES_MEMORY_KEY,
  schema: changesMemorySchema,
})

export const recallChanges = (sessionId: string): string[] =>
  memories.recall(sessionId)?.expanded ?? []

export function rememberChanges(args: { sessionId: string; expanded: string[] }): void {
  memories.remember({ threadId: args.sessionId, memory: { expanded: args.expanded } })
}

export const scopedPathsOf = (args: { checkoutId: string; expanded: string[] }): string[] =>
  args.expanded
    .filter((key) => key.startsWith(`${args.checkoutId}:`))
    .map((key) => key.slice(args.checkoutId.length + 1))

export function withScopedPaths(args: {
  checkoutId: string
  expanded: string[]
  paths: string[]
}): string[] {
  const prefix = `${args.checkoutId}:`
  return [
    ...args.expanded.filter((key) => !key.startsWith(prefix)),
    ...args.paths.map((path) => `${prefix}${path}`),
  ]
}
