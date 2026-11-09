import { EKilledBy, type ThreadId } from '@dltech/atlas-core'
import type { PodCrew, SubagentSaid, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

import { ChildRun, type ChildRunArgs } from './child-run'

export type CrewRoomArgs = Omit<ChildRunArgs, 'agentType' | 'intent'>

export class CrewRoom {
  private readonly runs = new Map<ThreadId, ChildRun>()

  constructor(private readonly args: CrewRoomArgs) {}

  async spawn(args: {
    agentType: string
    intent: string
    prompt: string
  }): Promise<SubagentSnapshot> {
    const run = await ChildRun.open({
      ...this.args,
      agentType: args.agentType,
      intent: args.intent,
    })
    this.runs.set(run.agentId, run)
    run.start(args.prompt)
    return run.snapshot()
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
  }

  private find(agentId: string): ChildRun {
    const run = this.runs.get(agentId as ThreadId)
    if (run === undefined) throw new Error(`no sub-agent ${agentId} in this session`)
    return run
  }
}
