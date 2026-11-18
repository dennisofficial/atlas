import { EKilledBy, lostAgentEnding, type ThreadId } from '@dltech/atlas-core'
import type {
  PodCrew,
  SubagentSaid,
  SubagentSnapshot,
  WorktreeEntryInfo,
} from '@dltech/atlas-plugin-sdk'

import { ChildRun, type ChildRunArgs } from './child-run'
import type { OpenChild } from './open-children'

export type CrewRoomArgs = Omit<ChildRunArgs, 'agentType' | 'intent'>

export class CrewRoom {
  private readonly runs = new Map<ThreadId, ChildRun>()

  constructor(private readonly args: CrewRoomArgs) {}

  async spawn(args: {
    agentType: string
    intent: string
    prompt: string
    worktree?: WorktreeEntryInfo | undefined
  }): Promise<SubagentSnapshot> {
    const run = await ChildRun.open({
      ...this.args,
      agentType: args.agentType,
      intent: args.intent,
      ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
    })
    this.runs.set(run.agentId, run)
    void run.say(args.prompt)
    return run.snapshot()
  }

  async adoptAll(children: readonly OpenChild[]): Promise<void> {
    for (const child of children) await this.adopt(child)
  }

  async adopt(child: OpenChild): Promise<void> {
    const run = await ChildRun.adopt({
      ...this.args,
      agentType: child.agentType,
      intent: child.intent,
      agentId: child.agentId,
      spawnedAt: child.spawnedAt,
      ...(child.worktree === undefined ? {} : { worktree: child.worktree }),
    })
    if (run === undefined) {
      await this.lose(child)
      return
    }
    this.runs.set(run.agentId, run)
    run.continueTurn()
  }

  say(args: { agentId: string; text: string }): Promise<SubagentSaid> {
    return this.find(args.agentId).say(args.text)
  }

  stop(args: { agentId: string }): SubagentSnapshot {
    return this.find(args.agentId).stop(EKilledBy.Model)
  }

  list(): readonly SubagentSnapshot[] {
    return [...this.runs.values()].map((run) => run.snapshot())
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
      list: () => this.list(),
      report: async () => {
        throw new Error(
          'only a sub-agent reports to the main agent; the main agent answers the user',
        )
      },
    }
  }

  async stopAll(): Promise<void> {
    const running = [...this.runs.values()]
    for (const run of running) run.stop(EKilledBy.SessionEnd)
    await Promise.all(running.map((run) => run.done))
    this.disposeAll()
  }

  async close(args: { draining: boolean }): Promise<void> {
    if (args.draining) {
      this.pauseAll()
      return
    }
    await this.stopAll()
  }

  pauseAll(): void {
    for (const run of this.runs.values()) run.pause()
    this.disposeAll()
  }

  disposeAll(): void {
    for (const run of this.runs.values()) run.dispose()
  }

  private async lose(child: OpenChild): Promise<void> {
    await this.args.parentRecord.append({
      threadId: this.args.parentThreadId,
      runId: this.args.deps.ids.nextRunId(),
      drafts: [
        lostAgentEnding({
          agent: child,
          progress: { turns: 0, toolCalls: 0, prose: '' },
        }),
      ],
    })
  }

  private find(agentId: string): ChildRun {
    const run = this.runs.get(agentId as ThreadId)
    if (run === undefined) throw new Error(`no sub-agent ${agentId} in this session`)
    return run
  }
}
