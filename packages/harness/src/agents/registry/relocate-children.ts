import {
  EAgentRestart,
  EAgentStatus,
  EExecutionLocation,
  EKilledBy,
  projectDirectoryOf,
  type EventDraft,
  type ExecutionLocationSinkPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { isTeammateType } from '../types'
import { agentEndedDraft, isStepping, type ChildState } from './child-state'
import type { ChildSteps } from './child-steps'
import type { NoticeDelivery } from './delivery'
import type { SupervisorDeps } from './deps'
import type { RelocateChildrenArgs } from './port'
import { resumeChild } from './resume-child'

export { resumeChild } from './resume-child'
import type { ChildRecovery } from './recovery'
import type { AgentRoster } from './roster'
import { pauseChild, stopChild } from './stop-all'

export type Relocation = {
  deps: SupervisorDeps
  sink: ExecutionLocationSinkPort
  roster: AgentRoster
  steps: ChildSteps
  recovery: ChildRecovery
  delivery: NoticeDelivery
}

const isTerminalEnding = (draft: EventDraft): boolean =>
  draft.type === 'agent-ended' &&
  (draft.status === EAgentStatus.Finished || draft.status === EAgentStatus.Failed ||
    (draft.status === EAgentStatus.Stopped &&
      draft.killedBy !== undefined &&
      draft.killedBy !== EKilledBy.ContainerSwitch))

export async function childDirectory({
  deps,
  threadId,
}: {
  deps: SupervisorDeps
  threadId: ThreadId
}): Promise<string> {
  return projectDirectoryOf({
    events: await deps.log.read({ threadId }),
    launchDirectory: deps.launchDirectory,
  })
}

export async function stopThreadChildren({
  threadId,
  by,
  caller,
  skipTeammates = false,
  roster,
  steps,
  recovery,
}: {
  threadId: ThreadId
  by: EKilledBy
  caller?: ThreadId | undefined
  skipTeammates?: boolean
} & Pick<Relocation, 'roster' | 'steps' | 'recovery'>): Promise<readonly ChildState[]> {
  await recovery.hydrate({ threadId })

  const stepping = relocatableChildren({ roster, threadId, skipTeammates }).filter(
    (child) => child.agentId !== caller && isStepping(child),
  )
  for (const child of stepping) stopChild({ child, by })

  const kept = skipTeammates
    ? teammateChildren({ roster, threadId }).map((child) => child.agentId)
    : []
  await steps
    .whenSettled({ threadId, excluding: [...(caller === undefined ? [] : [caller]), ...kept] })
    .catch(() => undefined)

  return stepping
}

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
  const children = roster.states().filter((child) => family.has(child.spawnedBy) && child.agentId !== caller)
  const stepping = children.filter(isStepping)
  for (const child of stepping) pauseChild({ child })
  const settlements = await Promise.allSettled(children.map((child) => steps.whenSettled({
    threadId: child.spawnedBy,
    excluding: roster.states().filter((sibling) => sibling.agentId !== child.agentId).map((sibling) => sibling.agentId),
  })))
  for (const owner of family) {
    await recovery.hydrate({ threadId: owner })
    for (const child of await deps.threads.spawned({ threadId: owner })) family.add(child.id)
  }
  await steps.whenAdmitted({ threadIds: [...family] })
  const rejected = settlements.find((result) => result.status === 'rejected')
  if (rejected === undefined && roster.states().some((child) => family.has(child.spawnedBy) && child.agentId !== caller &&
    (!children.includes(child) || (isStepping(child) && !child.pause.paused)))) {
    return pauseThreadChildren({ threadId, caller, roster, steps, recovery, deps, delivery })
  }
  for (const owner of family) await flushPendingEndings({ threadId: owner, deps, delivery })
  if (rejected?.status === 'rejected') throw rejected.reason
  for (const child of children) {
    if (child.status !== EAgentStatus.Paused && child.status !== EAgentStatus.Finished && child.status !== EAgentStatus.Failed) continue
    const events = await deps.log.readOwn({ threadId: child.spawnedBy })
    const latest = events.findLast((event) =>
      (event.type === 'agent-ended' || event.type === 'agent-restarted') && event.agentId === child.agentId)
    if (latest?.type !== 'agent-ended' || latest.status !== child.status) {
      await deps.log.append({ threadId: child.spawnedBy, runId: deps.ids.nextRunId(), drafts: [agentEndedDraft(child)] })
    }
    delivery.drainEndings({ threadId: child.spawnedBy, where: (notice) =>
      notice.draft.type === 'agent-ended' && notice.draft.agentId === child.agentId && notice.draft.status === EAgentStatus.Paused })
  }
  if (steps.admitting({ threadIds: [...family] })) {
    return pauseThreadChildren({ threadId, caller, roster, steps, recovery, deps, delivery })
  }
  const unsafe = children.find((child) => child.status === EAgentStatus.Failed || isStepping(child) ||
    (stepping.includes(child) && child.status !== EAgentStatus.Paused && child.status !== EAgentStatus.Finished))
  if (unsafe !== undefined) throw new Error(`child ${unsafe.agentId} is ${unsafe.status} instead of paused or completed`)
  return children.filter((child) => child.status === EAgentStatus.Paused)
}

export async function markThreadChildrenRelocated({
  threadId,
  location,
  skipTeammates = false,
  deps,
  sink,
  roster,
  recovery,
}: {
  threadId: ThreadId
  location: EExecutionLocation
  skipTeammates?: boolean
} & Pick<Relocation, 'deps' | 'sink' | 'roster' | 'recovery'>): Promise<void> {
  await recovery.hydrate({ threadId })

  for (const child of relocatableChildren({ roster, threadId, skipTeammates })) {
    await deps.threads.chooseExecutionLocation({ threadId: child.agentId, location })
    await sink.refresh({ threadId: child.agentId })
  }
}

const pendingEndings = new WeakMap<NoticeDelivery, Map<ThreadId, readonly EventDraft[]>>()

export async function flushPendingEndings({
  threadId,
  deps,
  delivery,
}: {
  threadId: ThreadId
} & Pick<Relocation, 'deps' | 'delivery'>): Promise<void> {
  const pending = pendingEndings.get(delivery) ?? new Map<ThreadId, readonly EventDraft[]>()
  pendingEndings.set(delivery, pending)
  const drafts = [
    ...(pending.get(threadId) ?? []),
    ...delivery.drainEndings({ threadId, where: (notice) => isTerminalEnding(notice.draft) }),
  ]
  if (drafts.length === 0) return
  pending.set(threadId, drafts)
  await deps.log.append({ threadId, runId: deps.ids.nextRunId(), drafts })
  pending.delete(threadId)
}

export async function relocateThreadChildren(
  args: RelocateChildrenArgs & Relocation,
): Promise<readonly ThreadId[]> {
  const { threadId, location, deps, roster } = args

  const stepping = await stopThreadChildren({ ...args, by: EKilledBy.ContainerSwitch, skipTeammates: true })
  await flushPendingEndings(args)

  const children = relocatableChildren({ roster, threadId, skipTeammates: true })
  const froms = new Map<ThreadId, EExecutionLocation>()
  for (const child of children) {
    const stored = await deps.threads.find({ threadId: child.agentId })
    froms.set(child.agentId, stored?.executionLocation ?? EExecutionLocation.Host)
  }

  await markThreadChildrenRelocated({ ...args, skipTeammates: true })

  for (const child of children) {
    await deps.log.append({
      threadId: child.agentId,
      runId: deps.ids.nextRunId(),
      drafts: [
        {
          type: 'location-changed',
          from: froms.get(child.agentId) ?? EExecutionLocation.Host,
          to: location,
        },
      ],
    })
  }

  for (const child of stepping) {
    await resumeChild({
      agentId: child.agentId,
      threadId,
      deps,
      roster,
      steps: args.steps,
      via: EAgentRestart.Relocation,
    })
  }

  return stepping.map((child) => child.agentId)
}

function teammateChildren({
  roster,
  threadId,
}: {
  roster: AgentRoster
  threadId: ThreadId
}): readonly ChildState[] {
  return roster
    .states()
    .filter((child) => child.spawnedBy === threadId && isTeammateType(child.agentType))
}

function relocatableChildren({
  roster,
  threadId,
  skipTeammates,
}: {
  roster: AgentRoster
  threadId: ThreadId
  skipTeammates: boolean
}): readonly ChildState[] {
  if (!skipTeammates) return roster.states().filter((child) => child.spawnedBy === threadId)

  const teammates = new Set(
    teammateChildren({ roster, threadId }).map((child) => child.agentId),
  )
  return roster
    .states()
    .filter((child) => child.spawnedBy === threadId && !teammates.has(child.agentId))
}
