import { z } from 'zod'

import { createThreadMemory } from '@/features/threads/panel/thread-memory'

import { ESessionPaneTab } from './pane-tab'

export const SESSION_PANE_KEY = 'atlas:session-pane'

const sessionPaneSchema = z.object({
  tab: z.enum(ESessionPaneTab).optional(),
  contextOpen: z.array(z.string()).optional(),
})

export type SessionPaneMemory = z.infer<typeof sessionPaneSchema>

const panes = createThreadMemory({
  key: SESSION_PANE_KEY,
  schema: sessionPaneSchema,
})

const mergePaneMemory = (args: { sessionId: string; memory: SessionPaneMemory }): void =>
  panes.remember({
    threadId: args.sessionId,
    memory: { ...panes.recall(args.sessionId), ...args.memory },
  })

export const recallPaneTab = (sessionId: string): ESessionPaneTab | undefined =>
  panes.recall(sessionId)?.tab

export function rememberPaneTab(args: { sessionId: string; tab: ESessionPaneTab }): void {
  mergePaneMemory({ sessionId: args.sessionId, memory: { tab: args.tab } })
}

export const recallContextOpen = (sessionId: string): readonly string[] =>
  panes.recall(sessionId)?.contextOpen ?? []

export function rememberContextOpen(args: { sessionId: string; open: readonly string[] }): void {
  mergePaneMemory({ sessionId: args.sessionId, memory: { contextOpen: [...args.open] } })
}
