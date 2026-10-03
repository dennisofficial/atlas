import type {
  EExecutionLocation,
  EKilledBy,
  EventDraft,
  SaidFile,
  SaidImage,
  ThreadId,
} from '@dltech/atlas-core'
import { agentOutcomeWireSchema, EClientRequest } from '@dltech/atlas-wire'
import {
  AgentRegistryPort,
  toAgentSnapshot,
  type AgentOutcome,
  type AgentSnapshot,
  type AgentType,
  type CloudChannel,
  type NoticeDrain,
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
 * over the channel. The sandbox's supervisor owns the children, so spawning stays refused here —
 * opening a child on the wrong machine is exactly what the local registry would do — while
 * steering forwards through the channel to the sandbox's own registry, the same registry the
 * agents inside steer each other through.
 */
export class RemoteAgentRegistry extends AgentRegistryPort {
  private heldEverywhere: readonly AgentSnapshot[] = []
  private readonly scoped = new Map<ThreadId, readonly AgentSnapshot[]>()
  private revision = 0

  constructor(
    private readonly roster: SharedRoster,
    private readonly channel: Pick<CloudChannel, 'request'>,
  ) {
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

  say(args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
  }): Promise<AgentOutcome> {
    return this.steer({ op: EClientRequest.SayToAgent, params: args })
  }

  sayToPeer(args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
  }): Promise<AgentOutcome> {
    return this.say(args)
  }

  reportToParent(_args: { threadId: ThreadId; text: string }): Promise<AgentOutcome> {
    return remoteActionRefused('a cloud session reports to its main agent in its sandbox, not on this machine')
  }

  resume(args: { agentId: ThreadId; threadId: ThreadId }): Promise<AgentOutcome> {
    return this.steer({ op: EClientRequest.ResumeAgent, params: args })
  }

  wake(_args: { agentId: ThreadId }): Promise<AgentOutcome> {
    return remoteActionRefused('a cloud session wakes sub-agents in its sandbox, not on this machine')
  }

  stop(args: { agentId: ThreadId; threadId: ThreadId; by: EKilledBy }): Promise<AgentOutcome> {
    return this.steer({ op: EClientRequest.StopAgent, params: { threadId: args.threadId, agentId: args.agentId } })
  }

  /**
   * The sandbox answers with its own registry's outcome; a parked sandbox is woken by the channel
   * itself, exactly as a message to the main thread wakes it.
   */
  private async steer(args: {
    op: EClientRequest.SayToAgent | EClientRequest.ResumeAgent | EClientRequest.StopAgent
    params: Record<string, unknown>
  }): Promise<AgentOutcome> {
    const data = await this.channel.request({ op: args.op, params: args.params })
    const parsed = agentOutcomeWireSchema.safeParse(data)
    if (!parsed.success) {
      return { ok: false, reason: 'the sandbox answered the steer with a shape this build does not know' }
    }

    const outcome = parsed.data
    if (!outcome.ok) return { ok: false, reason: outcome.reason }
    return { ok: true, snapshot: toAgentSnapshot(outcome.snapshot) }
  }

  async relocateChildren(_args: RelocateChildrenArgs): Promise<readonly ThreadId[]> {
    return []
  }

  async stopChildren(_args: { threadId: ThreadId; by: EKilledBy }): Promise<readonly ThreadId[]> {
    return []
  }

  async pauseChildren(_args: { threadId: ThreadId }): Promise<readonly ThreadId[]> {
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

  drainNotifications(_args: { threadId: ThreadId }): NoticeDrain {
    return { drafts: [], wakesTurn: false }
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
