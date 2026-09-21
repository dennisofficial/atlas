import {
  EExecutionLocation,
  EKilledBy,
  projectDirectoryOf,
  type ExecutionLocationSinkPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { isTeammateType } from '../types'
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

/**
 * The local-flip half of a relocation, on its own: a cloud lift appends `location-changed` to
 * each child's *remote* log itself, so this only moves the local routing that decides where the
 * next step for that child runs.
 */
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
    sink.note({ threadId: child.agentId, location })
  }
}

export async function relocateThreadChildren(
  args: RelocateChildrenArgs & Relocation,
): Promise<readonly ThreadId[]> {
  const { threadId, location, deps, roster } = args

  const stepping = await stopThreadChildren({ ...args, by: EKilledBy.ContainerSwitch, skipTeammates: true })

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
    await resumeChild({ agentId: child.agentId, threadId, deps, roster, steps: args.steps })
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
