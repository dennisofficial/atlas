import {
  EExecutionLocation,
  EKilledBy,
  projectDirectoryOf,
  type ExecutionLocationSinkPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { isStepping, snapshotOf, type ChildState } from './child-state'
import type { ChildSteps } from './child-steps'
import { agentTypeNamed, type SupervisorDeps } from './deps'
import type { AgentOutcome, RelocateChildrenArgs } from './port'
import { alreadyStepping, retiredAgentType, unknownAgent } from './reasons'
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

/**
 * The stop half of a relocation, on its own: a cloud lift needs to interrupt every stepping child
 * and wait for the interruption to land before it snapshots their logs, but must not touch their
 * location or resume them here — that happens once their transferred logs exist remotely.
 */
export async function stopThreadChildren({
  threadId,
  by,
  caller,
  roster,
  steps,
  recovery,
}: {
  threadId: ThreadId
  by: EKilledBy
  caller?: ThreadId | undefined
} & Pick<Relocation, 'roster' | 'steps' | 'recovery'>): Promise<readonly ChildState[]> {
  await recovery.hydrate({ threadId })

  const stepping = roster
    .states()
    .filter(
      (child) => child.spawnedBy === threadId && child.agentId !== caller && isStepping(child),
    )
  for (const child of stepping) stopChild({ child, by })
  await steps.whenSettled({ threadId, excluding: caller }).catch(() => undefined)

  return stepping
}

/**
 * The local-flip half of a relocation, on its own: a cloud lift appends `location-changed` to
 * each child's *remote* log itself, so this only moves the local routing that decides where the
 * next step for that child runs.
 */
export async function markThreadChildrenRelocated({
  threadId,
  location,
  deps,
  sink,
  roster,
  recovery,
}: {
  threadId: ThreadId
  location: EExecutionLocation
} & Pick<Relocation, 'deps' | 'sink' | 'roster' | 'recovery'>): Promise<void> {
  await recovery.hydrate({ threadId })

  const children = roster.states().filter((child) => child.spawnedBy === threadId)
  for (const child of children) {
    await deps.threads.chooseExecutionLocation({ threadId: child.agentId, location })
    sink.note({ threadId: child.agentId, location })
  }
}

export async function relocateThreadChildren(
  args: RelocateChildrenArgs & Relocation,
): Promise<readonly ThreadId[]> {
  const { threadId, location, deps, roster } = args

  const stepping = await stopThreadChildren({ ...args, by: EKilledBy.ContainerSwitch })

  const children = roster.states().filter((child) => child.spawnedBy === threadId)
  const froms = new Map<ThreadId, EExecutionLocation>()
  for (const child of children) {
    const stored = await deps.threads.find({ threadId: child.agentId })
    froms.set(child.agentId, stored?.executionLocation ?? EExecutionLocation.Host)
  }

  await markThreadChildrenRelocated(args)

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
    await resumeChild({ agentId: child.agentId, threadId, deps, roster, steps: args.steps })
  }

  return stepping.map((child) => child.agentId)
}

export async function resumeChild(
  args: { agentId: ThreadId; threadId: ThreadId } & Pick<Relocation, 'deps' | 'roster' | 'steps'>,
): Promise<AgentOutcome> {
  const { agentId, threadId, deps, roster, steps } = args

  const found = roster.find(agentId)
  const child = found === undefined || found.spawnedBy !== threadId ? undefined : found
  if (child === undefined) {
    return { ok: false, reason: unknownAgent({ agentId, known: roster.list(threadId) }) }
  }
  if (isStepping(child)) return { ok: false, reason: alreadyStepping(agentId) }

  const agentType = agentTypeNamed({ agentTypes: deps.agentTypes, name: child.agentType })
  if (agentType === undefined) {
    return { ok: false, reason: retiredAgentType(child.agentType) }
  }

  child.projectDirectory ??= await childDirectory({ deps, threadId })
  steps.take({
    child,
    agentType,
    step: ({ runner, signal }) => runner.resume({ threadId: agentId, signal }),
  })

  return { ok: true, snapshot: snapshotOf(child) }
}
