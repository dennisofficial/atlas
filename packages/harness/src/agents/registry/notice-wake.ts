import { EAgentRestart, type ThreadId } from '@dltech/atlas-core'

import type { AgentType } from '../types'
import { isStepping, snapshotOf } from './child-state'
import type { ChildSteps } from './child-steps'
import { agentTypeNamed, type SupervisorDeps } from './deps'
import type { AgentOutcome } from './port'
import { recordRestart } from './record-restart'
import { childDirectory } from './relocate-children'
import { alreadyStepping, deliberatelyStopped, retiredAgentType, unknownAgent } from './reasons'
import type { AgentRoster } from './roster'

export class NoticeWake {
  private readonly roster: AgentRoster
  private readonly steps: ChildSteps
  private readonly agentTypes: readonly AgentType[]
  private readonly deps: SupervisorDeps
  private readonly reserved = new Set<ThreadId>()

  constructor(args: {
    roster: AgentRoster
    steps: ChildSteps
    agentTypes: readonly AgentType[]
    deps: SupervisorDeps
  }) {
    this.roster = args.roster
    this.steps = args.steps
    this.agentTypes = args.agentTypes
    this.deps = args.deps
  }

  wake(args: { agentId: ThreadId }): Promise<AgentOutcome> {
    const child = this.roster.find(args.agentId)
    return this.steps.admit({
      threadId: child?.spawnedBy ?? args.agentId,
      start: () => this.wakeAdmitted(args),
    })
  }

  private async wakeAdmitted({ agentId }: { agentId: ThreadId }): Promise<AgentOutcome> {
    const child = this.roster.find(agentId)
    if (child === undefined) {
      return { ok: false, reason: unknownAgent({ agentId, known: this.roster.listEverywhere() }) }
    }
    if (isStepping(child) || this.reserved.has(agentId)) {
      return { ok: false, reason: alreadyStepping(agentId) }
    }
    if (child.killedBy !== undefined) {
      return { ok: false, reason: deliberatelyStopped({ agentId }) }
    }

    const agentType = agentTypeNamed({ agentTypes: this.agentTypes, name: child.agentType })
    if (agentType === undefined) {
      return { ok: false, reason: retiredAgentType(child.agentType) }
    }

    this.reserved.add(agentId)
    try {
      child.projectDirectory ??= await childDirectory({ deps: this.deps, threadId: child.spawnedBy })
      if (isStepping(child)) return { ok: false, reason: alreadyStepping(agentId) }
      if (child.killedBy !== undefined) {
        return { ok: false, reason: deliberatelyStopped({ agentId }) }
      }

      await recordRestart({ log: this.deps.log, ids: this.deps.ids, child, via: EAgentRestart.Wake })
      if (isStepping(child)) return { ok: false, reason: alreadyStepping(agentId) }
      if (child.killedBy !== undefined) {
        return { ok: false, reason: deliberatelyStopped({ agentId }) }
      }

      this.steps.take({
        child,
        agentType,
        step: ({ runner, signal, pause }) => runner.runTurn({ threadId: agentId, signal, pause }),
      })
      return { ok: true, snapshot: snapshotOf(child) }
    } finally {
      this.reserved.delete(agentId)
    }
  }
}
