import { lostAgentEnding, unendedSpawns, type IdPort, type ThreadId } from '@dltech/atlas-core'

import type { SessionRecord } from '../record/record-adapter'

export const settleOpenChildren = async (args: {
  record: SessionRecord
  ids: IdPort
  threadId: ThreadId
}): Promise<number> => {
  const open = unendedSpawns(await args.record.ownEvents({ threadId: args.threadId }))
  for (const spawn of open) {
    await args.record.append({
      threadId: args.threadId,
      runId: args.ids.nextRunId(),
      drafts: [
        lostAgentEnding({
          agent: { agentId: spawn.agentId, agentType: spawn.agentType, intent: spawn.intent },
          progress: { turns: 0, toolCalls: 0, prose: '' },
        }),
      ],
    })
  }
  return open.length
}
