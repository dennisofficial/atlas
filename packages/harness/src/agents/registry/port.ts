import type { EExecutionLocation, EKilledBy, EventDraft, SaidImage, ThreadId } from '@dltech/atlas-core'

import type { AgentType } from '../types'
import type { AgentSnapshot, RecoveredAgents } from './snapshot'

export type AgentOutcome = { ok: true; snapshot: AgentSnapshot } | { ok: false; reason: string }

export type RelocateChildrenArgs = {
  threadId: ThreadId
  location: EExecutionLocation
  /** The thread executing the relocation: its own in-flight step can never settle into the wait, so it is re-routed without being stopped. */
  caller?: ThreadId | undefined
}

/**
 * A sub-agent belongs to the thread that spawned it, so every read and every steer is scoped to
 * that owner; only the exit guard and teardown look across all of them.
 */
export abstract class AgentRegistryPort {
  abstract types(): readonly AgentType[]
  abstract spawn(args: {
    threadId: ThreadId
    agentType: string
    brief: string
    intent: string
  }): Promise<AgentOutcome>
  abstract say(args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
  }): Promise<AgentOutcome>
  abstract sayToPeer(args: {
    agentId: ThreadId
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[] | undefined
  }): Promise<AgentOutcome>
  abstract resume(args: { agentId: ThreadId; threadId: ThreadId }): Promise<AgentOutcome>
  abstract wake(args: { agentId: ThreadId }): Promise<AgentOutcome>
  abstract stop(args: { agentId: ThreadId; threadId: ThreadId; by: EKilledBy }): AgentOutcome
  abstract relocateChildren(args: RelocateChildrenArgs): Promise<readonly ThreadId[]>
  abstract stopChildren(args: { threadId: ThreadId; by: EKilledBy }): Promise<readonly ThreadId[]>
  abstract markChildrenRelocated(args: {
    threadId: ThreadId
    location: EExecutionLocation
  }): Promise<void>
  abstract list(args: { threadId: ThreadId }): readonly AgentSnapshot[]
  abstract hydrate(args: { threadId: ThreadId }): Promise<void>
  abstract whenChildrenSettled(args: { threadId: ThreadId }): Promise<void>
  abstract removeChildren(args: {
    threadId: ThreadId
    agentIds: readonly ThreadId[]
  }): Promise<void>
  abstract recordLostAgents(args: { threadId: ThreadId }): Promise<RecoveredAgents>
  abstract listEverywhere(): readonly AgentSnapshot[]
  abstract drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
  abstract pendingNotices(args: { threadId: ThreadId }): readonly AgentSnapshot[]
  abstract threadsAwaitingNotice(): readonly ThreadId[]
  abstract onNotice(listener: () => void): () => void
  abstract onChange(listener: () => void): () => void
  abstract forgetNotices(args: { threadId: ThreadId }): void
  abstract closeAll(): Promise<void>
}
