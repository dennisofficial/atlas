import {
  EInputConsumed,
  INBOX_KIND_RETRY,
  type InboxEntry,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'

import type { SessionRecord } from './record/record-adapter'

export const childRetryAgentIdOf = (entry: InboxEntry): string | undefined => {
  if (entry.kind !== INBOX_KIND_RETRY) return undefined
  try {
    const parsed: unknown = JSON.parse(entry.payload)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const agentId = (parsed as { agentId?: unknown }).agentId
    return typeof agentId === 'string' && agentId.length > 0 ? agentId : undefined
  } catch {
    return undefined
  }
}

export const forMainThread = (entries: readonly InboxEntry[]): InboxEntry[] =>
  entries.filter((entry) => childRetryAgentIdOf(entry) === undefined)

export const retryChildrenIn = async (args: {
  entries: readonly InboxEntry[]
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
  retry: (agentId: string) => Promise<boolean>
  log?: LogPort | undefined
}): Promise<boolean> => {
  let dispatched = false
  for (const entry of args.entries) {
    const agentId = childRetryAgentIdOf(entry)
    if (agentId === undefined) continue
    if (!(await args.retry(agentId))) {
      args.log?.warn({
        source: 'holder.intake',
        message: `a retry names sub-agent ${agentId}, which this session does not have`,
      })
    }
    await args.record.append({
      threadId: args.threadId,
      runId: args.runId(),
      drafts: [
        { type: 'input-consumed', inboxId: entry.inboxId, consumed: EInputConsumed.Discarded },
      ],
    })
    dispatched = true
  }
  return dispatched
}
