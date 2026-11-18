import { z } from 'zod'

import { createThreadMemory } from '@/features/threads/panel/thread-memory'

export const FILES_MEMORY_KEY = 'atlas:session-files'

const filesMemorySchema = z.object({
  selectedFile: z.string().optional(),
})

const memories = createThreadMemory({ key: FILES_MEMORY_KEY, schema: filesMemorySchema })

export const recallSelectedFile = (sessionId: string): string | undefined =>
  memories.recall(sessionId)?.selectedFile

export function rememberSelectedFile(args: { sessionId: string; path: string }): void {
  memories.remember({ threadId: args.sessionId, memory: { selectedFile: args.path } })
}
