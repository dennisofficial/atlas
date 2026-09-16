import {
  EExecutionLocation,
  EKilledBy,
  projectDirectoryOf,
  type ExecutionLocationSinkPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { isStepping } from './child-state'
import type { ChildSteps } from './child-steps'
import { agentTypeNamed, type SupervisorDeps } from './deps'
import type { RelocateChildrenArgs } from './port'
import type { ChildRecovery } from './recovery'
import type { AgentRoster } from './roster'
import { stopChild } from './stop-all'

export type Relocation = {
  deps: SupervisorDeps
  sink: ExecutionLocationSinkPort
  roster: AgentRoster
  steps: ChildSteps
  recovery: ChildRecovery
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

export async function relocateThreadChildren(
  args: RelocateChildrenArgs & Relocation,
): Promise<readonly ThreadId[]> {
  const { threadId, location, deps, sink, roster, steps, recovery } = args
  await recovery.hydrate({ threadId })

  const children = roster.states().filter((child) => child.spawnedBy === threadId)
  const stepping = children.filter(isStepping)
  for (const child of stepping) stopChild({ child, by: EKilledBy.ContainerSwitch })
  await steps.whenSettled()

  for (const child of children) {
    const stored = await deps.threads.find({ threadId: child.agentId })
    const from = stored?.executionLocation ?? EExecutionLocation.Host
    await deps.threads.chooseExecutionLocation({ threadId: child.agentId, location })
    sink.note({ threadId: child.agentId, location })
    await deps.log.append({
      threadId: child.agentId,
      runId: deps.ids.nextRunId(),
      drafts: [{ type: 'location-changed', from, to: location }],
    })
  }

  for (const child of stepping) {
    const agentType = agentTypeNamed({ agentTypes: deps.agentTypes, name: child.agentType })
    if (agentType === undefined) continue
    child.projectDirectory ??= await childDirectory({ deps, threadId })
    steps.take({
      child,
      agentType,
      step: ({ runner, signal }) => runner.resume({ threadId: child.agentId, signal }),
    })
  }

  return stepping.map((child) => child.agentId)
}
