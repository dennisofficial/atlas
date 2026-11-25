import {
  EAgentLostCause,
  EKilledBy,
  EResumeOutcome,
  heldDraftOf,
  lostAgentEnding,
  toLoopEvent,
  type AgentLost,
  type CrewRoomMember,
  type EventDraft,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type {
  PodCrew,
  SubagentSaid,
  SubagentSnapshot,
  WorktreeEntryInfo,
} from '@dltech/atlas-plugin-sdk'

import { ChildRun, type ChildRunArgs } from './child-run'
import type { CrewSender } from './child-message'
import { endingKeyOf, postNotice, threadLastSeq } from './child-reports'
import { settledChildOf, spawnedChildrenOf, type OpenChild } from './open-children'

export type CrewRoomArgs = Omit<
  ChildRunArgs,
  'agentType' | 'intent' | 'group' | 'groupHold' | 'saySibling'
>

class UnknownChild extends Error {}

export class CrewRoom {
  private readonly runs = new Map<ThreadId, ChildRun>()
  private posts: Promise<void> = Promise.resolve()

  constructor(private readonly args: CrewRoomArgs) {}

  async spawn(args: {
    agentType: string
    intent: string
    prompt: string
    group?: string | undefined
    callId?: string | undefined
    worktree?: WorktreeEntryInfo | undefined
  }): Promise<SubagentSnapshot> {
    const spawned = await this.spawnedForCall(args.callId)
    if (spawned !== undefined) return spawned
    const run = await ChildRun.open({
      ...this.childArgs(),
      agentType: args.agentType,
      intent: args.intent,
      brief: args.prompt,
      groupHold: (draft) => this.holdOf(draft),
      postHold: (post) => this.postInOrder(post),
      ...(args.group === undefined ? {} : { group: args.group }),
      ...(args.callId === undefined ? {} : { callId: args.callId }),
      ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
    })
    this.runs.set(run.agentId, run)
    await run.beginQueued()
    return run.snapshot()
  }

  private async spawnedForCall(callId: string | undefined): Promise<SubagentSnapshot | undefined> {
    if (callId === undefined) return undefined
    const spawn = (await this.parentEvents()).findLast(
      (event): event is Extract<V2Event, { type: 'agent-spawned' }> =>
        event.type === 'agent-spawned' && event.callId === callId,
    )
    if (spawn === undefined) return undefined
    const kept = this.runs.get(spawn.agentId as ThreadId)
    if (kept !== undefined) return kept.snapshot()
    const child = await this.openChildOf(spawn.agentId as ThreadId)
    if (child === undefined) return undefined
    await this.adopt(child)
    return this.runs.get(spawn.agentId as ThreadId)?.snapshot()
  }

  private async parentEvents(): Promise<readonly V2Event[]> {
    return await this.args.parentRecord.ownEvents({ threadId: this.args.parentThreadId })
  }

  private async openChildOf(agentId: ThreadId): Promise<OpenChild | undefined> {
    const loopEvents = (await this.parentEvents()).flatMap((event) => {
      const loop = toLoopEvent({ event })
      return loop === undefined ? [] : [loop]
    })
    return spawnedChildrenOf(loopEvents).find((child) => child.agentId === agentId)
  }

  async adoptAll(children: readonly OpenChild[]): Promise<void> {
    const adopted: ChildRun[] = []
    for (const child of children) {
      const run = await this.openAdopted(child)
      if (run !== undefined) adopted.push(run)
    }
    for (const run of adopted) await this.startAdopted(run)
  }

  async adopt(child: OpenChild): Promise<void> {
    const run = await this.openAdopted(child)
    if (run !== undefined) await this.startAdopted(run)
  }

  private async openAdopted(child: OpenChild): Promise<ChildRun | undefined> {
    const adopted = await ChildRun.adopt({
      ...this.childArgs(),
      agentType: child.agentType,
      intent: child.intent,
      agentId: child.agentId,
      spawnedAt: child.spawnedAt,
      groupHold: (draft) => this.holdOf(draft),
      postHold: (post) => this.postInOrder(post),
      ...(child.group === undefined ? {} : { group: child.group }),
      ...(child.worktree === undefined ? {} : { worktree: child.worktree }),
      ...(child.settled === undefined ? {} : { settled: child.settled }),
    })
    if (!adopted.ok) {
      await this.lose({ child, lost: adopted.lost })
      return undefined
    }
    this.runs.set(adopted.run.agentId, adopted.run)
    return adopted.run
  }

  private async startAdopted(run: ChildRun): Promise<void> {
    await run.finishAdopted()
    await run.continueTurn()
  }

  async say(args: {
    agentId: string
    text: string
    from?: CrewSender | undefined
    clientId?: string | undefined
  }): Promise<SubagentSaid | undefined> {
    const run = await this.runOrUndefined(args.agentId)
    return run === undefined
      ? undefined
      : await run.say({
          text: args.text,
          ...(args.from === undefined ? {} : { from: args.from }),
          ...(args.clientId === undefined ? {} : { clientId: args.clientId }),
        })
  }

  async resume(args: { agentId: string }): Promise<EResumeOutcome> {
    const run = await this.runOrUndefined(args.agentId)
    if (run === undefined) return EResumeOutcome.UnknownAgent
    return await run.resume()
  }

  async retry(args: { agentId: string }): Promise<boolean> {
    const run = await this.runOrUndefined(args.agentId)
    if (run === undefined) return false
    await run.continueTurn({ retry: true })
    return true
  }

  stop(args: { agentId: string }): SubagentSnapshot {
    return this.find(args.agentId).stop(EKilledBy.Model)
  }

  list(): readonly SubagentSnapshot[] {
    return [...this.runs.values()].map((run) => run.snapshot())
  }

  members(): readonly CrewRoomMember[] {
    return [...this.runs.values()].map((run) => run.member())
  }

  private holdOf(draft: EventDraft): EventDraft {
    return heldDraftOf({ input: draft, crew: this.members() })
  }

  private postInOrder(post: () => Promise<void>): Promise<void> {
    const queued = this.posts.then(post)
    this.posts = queued.catch(() => undefined)
    return queued
  }

  runningCount(): number {
    return [...this.runs.values()].filter((run) => run.isRunning()).length
  }

  hasRunning(): boolean {
    return this.runningCount() > 0
  }

  port(): PodCrew {
    return {
      spawn: (args) => this.spawn(args),
      say: (args) => this.say(args),
      stop: async (args) => this.stop(args),
      resume: (args) => this.resume(args),
      list: () => this.list(),
      report: async () => {
        throw new Error(
          'only a sub-agent reports to the main agent; the main agent answers the user',
        )
      },
    }
  }

  async stopAll(): Promise<void> {
    const all = [...this.runs.values()]
    for (const run of all) run.stop(EKilledBy.SessionEnd)
    await Promise.all(all.map((run) => run.done))
    await Promise.all(all.map((run) => run.endIdle(EKilledBy.SessionEnd)))
    this.disposeAll()
  }

  async close(args: { draining: boolean }): Promise<void> {
    if (args.draining) {
      await this.pauseAll()
      return
    }
    await this.stopAll()
  }

  async pauseAll(): Promise<void> {
    await Promise.all([...this.runs.values()].map((run) => run.pause()))
    this.disposeAll()
  }

  disposeAll(): void {
    for (const run of this.runs.values()) run.dispose()
  }

  private childArgs(): Omit<ChildRunArgs, 'agentType' | 'intent'> {
    return { ...this.args, saySibling: (said) => this.say(said) }
  }

  private async runOrUndefined(agentId: string): Promise<ChildRun | undefined> {
    const live = this.runs.get(agentId as ThreadId)
    if (live !== undefined) return live
    return await this.reopen(agentId as ThreadId).catch((error: unknown) => {
      if (error instanceof UnknownChild) return undefined
      throw error
    })
  }

  private async reopen(agentId: ThreadId): Promise<ChildRun> {
    const settled = settledChildOf({
      events: await this.args.parentRecord.ownEvents({ threadId: this.args.parentThreadId }),
      threadId: this.args.parentThreadId,
      agentId,
    })
    if (settled === undefined) throw new UnknownChild(`no sub-agent ${agentId} in this session`)
    const adopted = await ChildRun.adopt({
      ...this.childArgs(),
      agentType: settled.agentType,
      intent: settled.intent,
      agentId,
      spawnedAt: settled.spawnedAt,
      groupHold: (draft) => this.holdOf(draft),
      postHold: (post) => this.postInOrder(post),
      ...(settled.group === undefined ? {} : { group: settled.group }),
      settled: { status: settled.status, endedAt: settled.endedAt },
      ...(settled.worktree === undefined ? {} : { worktree: settled.worktree }),
    })
    if (adopted.ok) {
      this.runs.set(adopted.run.agentId, adopted.run)
      return adopted.run
    }
    if (adopted.lost.cause === EAgentLostCause.RecordUnreadable) {
      throw new Error(`the log of sub-agent ${agentId} could not be read: ${adopted.lost.detail}`)
    }
    throw new UnknownChild(`no sub-agent ${agentId} in this session`)
  }

  private async lose(args: { child: OpenChild; lost: AgentLost }): Promise<void> {
    const seq = await threadLastSeq({
      plane: this.args.deps.plane,
      threadId: args.child.agentId,
    }).catch(() => 0)
    await postNotice(this.args, {
      event: lostAgentEnding({
        agent: args.child,
        progress: { turns: 0, toolCalls: 0, prose: '' },
        lost: args.lost,
      }),
      key: endingKeyOf({ agentId: args.child.agentId, seq }),
    })
  }

  private find(agentId: string): ChildRun {
    const run = this.runs.get(agentId as ThreadId)
    if (run === undefined) throw new Error(`no sub-agent ${agentId} in this session`)
    return run
  }
}
