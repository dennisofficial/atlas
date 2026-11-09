import {
  EContextSlot,
  EStage,
  type BeforeTurn,
  type EventDraft,
  type HookOrder,
  type ThreadId,
} from '@dltech/atlas-core'

import type { McpStore } from './store'

export type McpInstructionsHook = {
  name: string
  order: HookOrder
  run: BeforeTurn
}

export const mcpInstructionsOf = (args: {
  live: ReadonlyMap<string, string>
  offered: Set<string>
}): EventDraft[] => {
  const drafts: EventDraft[] = []
  for (const [name, instructions] of args.live) {
    if (args.offered.has(name)) continue
    drafts.push({
      type: 'context-loaded',
      slot: EContextSlot.McpInstructions,
      key: name,
      content: instructions,
    })
    args.offered.add(name)
  }
  for (const name of [...args.offered]) {
    if (args.live.has(name)) continue
    drafts.push({
      type: 'context-loaded',
      slot: EContextSlot.McpInstructions,
      key: name,
      content: '',
    })
    args.offered.delete(name)
  }
  return drafts
}

export const mcpInstructionsHook = (args: {
  store: McpStore
  offered: Map<ThreadId, Set<string>>
}): McpInstructionsHook => ({
  name: 'mcp-instructions',
  order: { stage: EStage.Observe, nudge: 0 },
  run: async ({ threadId }) => {
    const offered = args.offered.get(threadId) ?? new Set<string>()
    const drafts = mcpInstructionsOf({ live: args.store.instructionsByServer(), offered })
    args.offered.set(threadId, offered)
    return drafts.length === 0 ? {} : { drafts }
  },
})
