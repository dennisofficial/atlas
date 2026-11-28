import { z } from 'zod'

import { createThreadMemory } from '@/features/threads/panel/thread-memory'

export const FILES_MEMORY_KEY = 'atlas:session-files'

const filesMemorySchema = z.object({
  selectedFile: z.string().optional(),
  contextFile: z.string().optional(),
})

type FilesMemory = z.infer<typeof filesMemorySchema>

const memories = createThreadMemory({ key: FILES_MEMORY_KEY, schema: filesMemorySchema })

const mergeFilesMemory = (args: { sessionId: string; memory: FilesMemory }): void =>
  memories.remember({
    threadId: args.sessionId,
    memory: { ...memories.recall(args.sessionId), ...args.memory },
  })

export const recallSelectedFile = (sessionId: string): string | undefined =>
  memories.recall(sessionId)?.selectedFile

export function rememberSelectedFile(args: { sessionId: string; path: string }): void {
  mergeFilesMemory({ sessionId: args.sessionId, memory: { selectedFile: args.path } })
}

export const recallContextFile = (sessionId: string): string | undefined =>
  memories.recall(sessionId)?.contextFile

export function rememberContextFile(args: { sessionId: string; path: string | undefined }): void {
  mergeFilesMemory({ sessionId: args.sessionId, memory: { contextFile: args.path } })
}
