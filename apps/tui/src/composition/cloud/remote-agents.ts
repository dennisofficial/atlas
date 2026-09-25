import type {
  EExecutionLocation,
  EKilledBy,
  EventDraft,
  SaidImage,
  ThreadId,
} from '@dltech/atlas-core'
import {
  AgentRegistryPort,
  type AgentOutcome,
  type AgentSnapshot,
  type AgentType,
  type RecoveredAgents,
  type RelocateChildrenArgs,
} from '@dltech/atlas-harness'

import { agentsFor, heldIfSame, type SharedRoster } from './roster-reader'

const remoteActionRefused = async (reason: string): Promise<AgentOutcome> => ({
  ok: false,
  reason,
})

const NO_PENDING_AGENTS: readonly AgentSnapshot[] = Object.freeze([])

/**
 * The agent registry as a cloud session's surfaces read it: the roster the sandbox's serve pushes
 * over the channel. The sandbox's supervisor owns the children, so spawning and steering here
 * refuse rather than opening a child on the wrong machine — the turn driver steers through the
 * channel, which is where the sandbox's own registry is reached.
 */
export class RemoteAgentRegistry extends AgentRegistryPort {
  private heldEverywhere: readonly AgentSnapshot[] = []
  private readonly scoped = new Map<ThreadId, readonly AgentSnapshot[]>()
  private revision = 0

  constructor(private readonly roster: SharedRoster) {
    super()
    roster.subscribe(() => this.sync())
    this.sync()
  }

  private sync(): void {
    const latest = this.roster.current().agents
    const held = heldIfSame(this.heldEverywhere, latest)
    if (held === this.heldEverywhere) return

    this.heldEverywhere = Object.freeze(held.slice())
    this.scoped.clear()
    this.revision += 1
  }

  types(): readonly AgentType[] {
    return []
  }

  spawn(_args: {
    threadId: ThreadId
    agentType: string
    brief: string
    intent: string
  }): Promise<AgentOutcome> {
    return remoteActionRefused('a cloud session spawns sub-agents in its sandbox, not on this machine')
  }

  say(_args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
  }): Promise<AgentOutcome> {
    return remoteActionRefused('a cloud session steers sub-agents in its sandbox, not on this machine')
  }

  sayToPeer(_args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
  }): Promise<AgentOutcome> {
    return remoteActionRefused('a cloud session steers sub-agents in its sandbox, not on this machine')
  }

  resume(_args: { agentId: ThreadId; threadId: ThreadId }): Promise<AgentOutcome> {
    return remoteActionRefused('a cloud session resumes sub-agents in its sandbox, not on this machine')
  }

  wake(_args: { agentId: ThreadId }): Promise<AgentOutcome> {
    return remoteActionRefused('a cloud session wakes sub-agents in its sandbox, not on this machine')
  }

  stop(_args: { agentId: ThreadId; threadId: ThreadId; by: EKilledBy }): AgentOutcome {
    return { ok: false, reason: 'a cloud session stops sub-agents in its sandbox, not on this machine' }
  }

  async relocateChildren(_args: RelocateChildrenArgs): Promise<readonly ThreadId[]> {
    return []
  }

  async stopChildren(_args: { threadId: ThreadId; by: EKilledBy }): Promise<readonly ThreadId[]> {
    return []
  }

  async markChildrenRelocated(_args: {
    threadId: ThreadId
    location: EExecutionLocation
  }): Promise<void> {}

  list(args: { threadId: ThreadId }): readonly AgentSnapshot[] {
    const held = this.scoped.get(args.threadId)
    const latest = agentsFor({ roster: this.roster.current(), threadId: args.threadId })
    if (held !== undefined && heldIfSame(held, latest) === held) return held

    const frozen = Object.freeze(latest.slice())
    this.scoped.set(args.threadId, frozen)
    return frozen
  }

  async hydrate(_args: { threadId: ThreadId }): Promise<void> {}

  async whenChildrenSettled(_args: { threadId: ThreadId }): Promise<void> {}

  async removeChildren(_args: {
    threadId: ThreadId
    agentIds: readonly ThreadId[]
  }): Promise<void> {}

  async recordLostAgents(_args: { threadId: ThreadId }): Promise<RecoveredAgents> {
    return { settled: [], unlogged: [] }
  }

  listEverywhere(): readonly AgentSnapshot[] {
    return this.heldEverywhere
  }

  drainNotifications(_args: { threadId: ThreadId }): readonly EventDraft[] {
    return []
  }

  pendingNotices(_args: { threadId: ThreadId }): readonly AgentSnapshot[] {
    return NO_PENDING_AGENTS
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return []
  }

  onNotice(_listener: () => void): () => void {
    return () => undefined
  }

  onChange(listener: () => void): () => void {
    return this.roster.subscribe(listener)
  }

  version(): number {
    return this.revision
  }

  forgetNotices(_args: { threadId: ThreadId }): void {}

  async closeAll(): Promise<void> {}
}
