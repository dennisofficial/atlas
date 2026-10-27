import { EAgentStatus, type ThreadId } from '@dltech/atlas-core'

import { agentEndedDraft, isHeld, isStepping, type ChildState } from './child-state'
import { flushPendingEndings } from './pending-endings'
import type { Relocation } from './relocate-children'
import { pauseChild } from './stop-all'

export async function pauseThreadChildren({
  threadId,
  caller,
  roster,
  steps,
  recovery,
  deps,
  delivery,
}: {
  threadId: ThreadId
  caller?: ThreadId | undefined
} & Pick<Relocation, 'roster' | 'steps' | 'recovery' | 'deps' | 'delivery'>): Promise<
  readonly ChildState[]
> {
  const family = new Set<ThreadId>([threadId])
  for (const owner of family) {
    for (const child of roster.states()) if (child.spawnedBy === owner) family.add(child.agentId)
  }
  await steps.whenAdmitted({ threadIds: [...family] })
  for (const owner of family) {
    await recovery.hydrate({ threadId: owner })
    for (const child of await deps.threads.spawned({ threadId: owner })) family.add(child.id)
  }
  await steps.whenAdmitted({ threadIds: [...family] })
  const children = roster
    .states()
    .filter((child) => family.has(child.spawnedBy) && child.agentId !== caller)
  const stepping = children.filter(isStepping)
  for (const child of stepping) pauseChild({ child })
  for (const child of children.filter(isHeld)) steps.pauseHeld({ child })
  const settlements = await Promise.allSettled(
    children.map((child) =>
      steps.whenSettled({
        threadId: child.spawnedBy,
        excluding: roster
          .states()
          .filter((sibling) => sibling.agentId !== child.agentId)
          .map((sibling) => sibling.agentId),
      }),
    ),
  )
  for (const owner of family) {
    await recovery.hydrate({ threadId: owner })
    for (const child of await deps.threads.spawned({ threadId: owner })) family.add(child.id)
  }
  await steps.whenAdmitted({ threadIds: [...family] })
  const rejected = settlements.find((result) => result.status === 'rejected')
  if (
    rejected === undefined &&
    roster
      .states()
      .some(
        (child) =>
          family.has(child.spawnedBy) &&
          child.agentId !== caller &&
          (!children.includes(child) || (isStepping(child) && !child.pause.paused)),
      )
  ) {
    return pauseThreadChildren({ threadId, caller, roster, steps, recovery, deps, delivery })
  }
  for (const owner of family) await flushPendingEndings({ threadId: owner, deps, delivery })
  if (rejected?.status === 'rejected') throw rejected.reason
  for (const child of children) {
    if (
      child.status !== EAgentStatus.Paused &&
      child.status !== EAgentStatus.Finished &&
      child.status !== EAgentStatus.Failed
    )
      continue
    const events = await deps.log.readOwn({ threadId: child.spawnedBy })
    const latest = events.findLast(
      (event) =>
        (event.type === 'agent-ended' || event.type === 'agent-restarted') &&
        event.agentId === child.agentId,
    )
    if (latest?.type !== 'agent-ended' || latest.status !== child.status) {
      await deps.log.append({
        threadId: child.spawnedBy,
        runId: deps.ids.nextRunId(),
        drafts: [agentEndedDraft(child)],
      })
    }
    delivery.drainEndings({
      threadId: child.spawnedBy,
      where: (notice) =>
        notice.draft.type === 'agent-ended' &&
        notice.draft.agentId === child.agentId &&
        notice.draft.status === EAgentStatus.Paused,
    })
  }
  if (steps.admitting({ threadIds: [...family] })) {
    return pauseThreadChildren({ threadId, caller, roster, steps, recovery, deps, delivery })
  }
  const unsafe = children.find(
    (child) =>
      isStepping(child) ||
      (stepping.includes(child) &&
        child.status !== EAgentStatus.Paused &&
        child.status !== EAgentStatus.Finished),
  )
  if (unsafe !== undefined)
    throw new Error(`child ${unsafe.agentId} is ${unsafe.status} instead of paused or completed`)
  return children.filter((child) => child.status === EAgentStatus.Paused)
}
