import { z } from 'zod'

import { createThreadMemory } from './thread-memory'

export const PANE_LAYOUTS_KEY = 'atlas:thread-pane-layouts'

const paneLayoutSchema = z.record(z.string(), z.number())

export type PaneLayout = z.infer<typeof paneLayoutSchema>

const paneLayouts = createThreadMemory({
  key: PANE_LAYOUTS_KEY,
  schema: paneLayoutSchema,
})

export const recallPaneLayout = (threadId: string): PaneLayout | undefined =>
  paneLayouts.recall(threadId)

export function rememberPaneLayout(args: { threadId: string; layout: PaneLayout }): void {
  paneLayouts.remember({ threadId: args.threadId, memory: args.layout })
}
