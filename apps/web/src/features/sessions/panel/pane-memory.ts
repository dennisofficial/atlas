import { z } from 'zod'

import { createThreadMemory } from '@/features/threads/panel/thread-memory'

import { ESessionPaneTab } from './pane-tab'

export const SESSION_PANE_KEY = 'atlas:session-pane'

const sessionPaneSchema = z.object({
  tab: z.enum(ESessionPaneTab).optional(),
})

export type SessionPaneMemory = z.infer<typeof sessionPaneSchema>

const panes = createThreadMemory({
  key: SESSION_PANE_KEY,
  schema: sessionPaneSchema,
})

export const recallPaneTab = (sessionId: string): ESessionPaneTab | undefined =>
  panes.recall(sessionId)?.tab

export function rememberPaneTab(args: { sessionId: string; tab: ESessionPaneTab }): void {
  panes.remember({ threadId: args.sessionId, memory: { tab: args.tab } })
}
