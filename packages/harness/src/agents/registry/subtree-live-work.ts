import { EAgentStatus, type ThreadId } from '@dltech/atlas-core'

import { isStepping, type ChildState } from './child-state'
import type { LiveWorkProbe } from './deps'
import type { AgentRoster } from './roster'

export class SubtreeLiveWork {
  private readonly roster: AgentRoster
  private readonly own: LiveWorkProbe

  constructor(args: { roster: AgentRoster; own: LiveWorkProbe }) {
    this.roster = args.roster
    this.own = args.own
  }

  waitingOn(child: ChildState): string | undefined {
    if (isStepping(child) || child.status === EAgentStatus.Failed) return undefined
    return this.reasonFor(child.agentId)
  }

  reasonFor(threadId: ThreadId): string | undefined {
    return this.walk({ threadId, children: this.roster.states(), visited: new Set() })
  }

  private walk({
    threadId,
    children,
    visited,
  }: {
    threadId: ThreadId
    children: readonly ChildState[]
    visited: Set<ThreadId>
  }): string | undefined {
    if (visited.has(threadId)) return undefined
    visited.add(threadId)

    const held = this.own(threadId)
    if (held !== undefined) return held

    const owned = children.filter((child) => child.spawnedBy === threadId)
    const working = owned.find(isStepping)
    if (working !== undefined) return `${working.intent} (working)`

    for (const child of owned) {
      const reason = this.walk({ threadId: child.agentId, children, visited })
      if (reason !== undefined) return `${child.intent}: ${reason}`
    }
    return undefined
  }
}
