import { unendedSpawns, type Event, type ThreadId } from '@dltech/atlas-core'
import type { WorktreeEntryInfo } from '@dltech/atlas-plugin-sdk'

import type { SessionRecord } from '../record/record-adapter'

export type OpenChild = {
  agentId: ThreadId
  agentType: string
  intent: string
  spawnedAt: string
  worktree: WorktreeEntryInfo | undefined
}

export const openChildrenOf = (events: readonly Event[]): readonly OpenChild[] =>
  unendedSpawns(events).map((spawn) => ({
    agentId: spawn.agentId,
    agentType: spawn.agentType,
    intent: spawn.intent,
    spawnedAt: spawn.at,
    worktree: spawn.worktree,
  }))

export const openChildren = async (args: {
  record: SessionRecord
  threadId: ThreadId
}): Promise<readonly OpenChild[]> =>
  openChildrenOf(await args.record.ownEvents({ threadId: args.threadId }))
