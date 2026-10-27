import {
  EAgentRestart,
  EExecutionLocation,
  EKilledBy,
  projectDirectoryOf,
  type ExecutionLocationSinkPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { isTeammateType } from '../types'
import { isHeld, isStepping, type ChildState } from './child-state'
import type { ChildSteps } from './child-steps'
import type { NoticeDelivery } from './delivery'
import type { SupervisorDeps } from './deps'
import { flushPendingEndings } from './pending-endings'
import type { RelocateChildrenArgs } from './port'
import { resumeChild } from './resume-child'

export { resumeChild } from './resume-child'
import type { ChildRecovery } from './recovery'
import type { AgentRoster } from './roster'
import { stopChild } from './stop-all'

export type Relocation = {
  deps: SupervisorDeps
  sink: ExecutionLocationSinkPort
  roster: AgentRoster
  steps: ChildSteps
  recovery: ChildRecovery
  delivery: NoticeDelivery
}

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
    (child) => child.agentId !== caller && (isStepping(child) || isHeld(child)),
  )
  for (const child of stepping) stopChild({ child, by, steps })

  const kept = skipTeammates
    ? teammateChildren({ roster, threadId }).map((child) => child.agentId)
    : []
  await steps
    .whenSettled({ threadId, excluding: [...(caller === undefined ? [] : [caller]), ...kept] })
    .catch(() => undefined)

  return stepping
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

export async function relocateThreadChildren(
  args: RelocateChildrenArgs & Relocation,
): Promise<readonly ThreadId[]> {
  const { threadId, location, deps, roster } = args

  const stepping = await stopThreadChildren({
    ...args,
    by: EKilledBy.ContainerSwitch,
    skipTeammates: true,
  })
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

  const teammates = new Set(teammateChildren({ roster, threadId }).map((child) => child.agentId))
  return roster
    .states()
    .filter((child) => child.spawnedBy === threadId && !teammates.has(child.agentId))
}
