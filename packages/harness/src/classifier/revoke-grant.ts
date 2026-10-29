import { grantsFrom, type EventLogPort, type IdPort, type ThreadId } from '@dltech/atlas-core'

export async function revokeGrant(args: {
  log: Pick<EventLogPort, 'append' | 'read'>
  ids: Pick<IdPort, 'nextRunId'>
  threadId: ThreadId
  grantId: string
}): Promise<boolean> {
  const { log, ids, threadId, grantId } = args
  const active = grantsFrom(await log.read({ threadId }))
  if (!active.some((grant) => grant.grantId === grantId)) return false
  await log.append({
    threadId,
    runId: ids.nextRunId(),
    drafts: [{ type: 'permission-revoked', grantId }],
  })
  return true
}
