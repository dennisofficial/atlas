import { z } from 'zod'

import { EChangeScope } from '@dltech/atlas-wire/web'

import { ERightTab } from './right-tab'
import { createThreadMemory } from './thread-memory'

export const THREAD_PANELS_KEY = 'atlas:thread-panels'

const threadPanelMemorySchema = z.object({
  tab: z.enum(ERightTab).optional(),
  openFolders: z.array(z.string()).optional(),
  selectedFile: z.string().optional(),
  filePath: z.string().optional(),
  contextPath: z.string().optional(),
  agentId: z.string().optional(),
  changesScope: z.enum(EChangeScope).optional(),
  changesExpanded: z.array(z.string()).optional(),
  changesCollapsed: z.array(z.string()).optional(),
})

export type ThreadPanelMemory = z.infer<typeof threadPanelMemorySchema>

const panels = createThreadMemory({
  key: THREAD_PANELS_KEY,
  schema: threadPanelMemorySchema,
})

export const recallThreadPanel = (threadId: string): ThreadPanelMemory =>
  panels.recall(threadId) ?? {}

export function rememberThreadPanel(args: { threadId: string; patch: ThreadPanelMemory }): void {
  panels.remember({
    threadId: args.threadId,
    memory: { ...recallThreadPanel(args.threadId), ...args.patch },
  })
}
