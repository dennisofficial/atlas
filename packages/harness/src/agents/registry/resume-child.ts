import { EAgentRestart, EAgentStatus, EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { isStepping, snapshotOf, type ChildState } from './child-state'
import { agentTypeNamed } from './deps'
import type { AgentOutcome } from './port'
import { alreadyStepping, retiredAgentType, terminalAgent, unknownAgent } from './reasons'
import { recordRestart } from './record-restart'
import { childDirectory, type Relocation } from './relocate-children'

type ResumeChildArgs = { agentId: ThreadId; threadId: ThreadId; via?: EAgentRestart | undefined } &
  Pick<Relocation, 'deps' | 'roster' | 'steps'>

const isTerminal = (child: ChildState): boolean => {
  if (child.status === EAgentStatus.Finished) return true
  return child.status === EAgentStatus.Stopped && child.killedBy !== undefined &&
    child.killedBy !== EKilledBy.ContainerSwitch
}

export function resumeChild(args: ResumeChildArgs): Promise<AgentOutcome> {
  return args.steps.admit({ threadId: args.threadId, start: () => resumeAdmitted(args) })
}

async function resumeAdmitted(args: ResumeChildArgs): Promise<AgentOutcome> {
  const { agentId, threadId, deps, roster, steps } = args
  const found = roster.find(agentId)
  const child = found === undefined || found.spawnedBy !== threadId ? undefined : found
  if (child === undefined) {
    return { ok: false, reason: unknownAgent({ agentId, known: roster.list(threadId) }) }
  }
  if (isStepping(child)) return { ok: false, reason: alreadyStepping(agentId) }
  if (isTerminal(child)) return { ok: false, reason: terminalAgent({ agentId, status: child.status }) }
  const agentType = agentTypeNamed({ agentTypes: deps.agentTypes, name: child.agentType })
  if (agentType === undefined) return { ok: false, reason: retiredAgentType(child.agentType) }
  child.projectDirectory ??= await childDirectory({ deps, threadId })
  await recordRestart({ log: deps.log, ids: deps.ids, child, via: args.via ?? EAgentRestart.Resume })
  steps.take({
    child,
    agentType,
    step: ({ runner, signal, pause }) => runner.resume({ threadId: agentId, signal, pause }),
  })
  return { ok: true, snapshot: snapshotOf(child) }
}
