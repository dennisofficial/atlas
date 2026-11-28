import { z } from 'zod'

import { createThreadMemory } from '@/features/threads/panel/thread-memory'

import { ESessionPaneTab } from './pane-tab'

export const SESSION_PANE_KEY = 'atlas:session-pane'

const agentMemorySchema = z.object({
  agentId: z.string(),
  parentAgentId: z.string().optional(),
})

const sessionPaneSchema = z.object({
  tab: z.enum(ESessionPaneTab).optional(),
  contextOpen: z.array(z.string()).optional(),
  detailsOpen: z.boolean().optional(),
  detailsFile: z.string().optional(),
  collapsed: z.boolean().optional(),
  agent: agentMemorySchema.optional(),
  collapsedBeforeAgent: z.boolean().optional(),
})

export type SessionPaneMemory = z.infer<typeof sessionPaneSchema>

export type RememberedAgent = z.infer<typeof agentMemorySchema>

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

export const DETAILS_CARD_OPEN_BY_DEFAULT = true

export const detailsCardOpenOf = (stored: boolean | undefined): boolean =>
  stored ?? DETAILS_CARD_OPEN_BY_DEFAULT

export const recallDetailsOpen = (sessionId: string): boolean =>
  detailsCardOpenOf(panes.recall(sessionId)?.detailsOpen)

export function rememberDetailsOpen(args: { sessionId: string; open: boolean }): void {
  mergePaneMemory({ sessionId: args.sessionId, memory: { detailsOpen: args.open } })
}

export const recallDetailsFile = (sessionId: string): string | undefined =>
  panes.recall(sessionId)?.detailsFile

export function rememberDetailsFile(args: { sessionId: string; path: string | undefined }): void {
  mergePaneMemory({ sessionId: args.sessionId, memory: { detailsFile: args.path } })
}

export const PANE_COLLAPSED_BY_DEFAULT = true

export const recallCollapsed = (sessionId: string): boolean =>
  panes.recall(sessionId)?.collapsed ?? PANE_COLLAPSED_BY_DEFAULT

export function rememberCollapsed(args: { sessionId: string; collapsed: boolean }): void {
  mergePaneMemory({ sessionId: args.sessionId, memory: { collapsed: args.collapsed } })
}

export const recallAgent = (sessionId: string): RememberedAgent | undefined =>
  panes.recall(sessionId)?.agent

export function rememberAgent(args: {
  sessionId: string
  agent: RememberedAgent | undefined
}): void {
  mergePaneMemory({ sessionId: args.sessionId, memory: { agent: args.agent } })
}

export const recallCollapsedBeforeAgent = (sessionId: string): boolean | undefined =>
  panes.recall(sessionId)?.collapsedBeforeAgent

export function rememberCollapsedBeforeAgent(args: {
  sessionId: string
  collapsed: boolean | undefined
}): void {
  mergePaneMemory({ sessionId: args.sessionId, memory: { collapsedBeforeAgent: args.collapsed } })
}
