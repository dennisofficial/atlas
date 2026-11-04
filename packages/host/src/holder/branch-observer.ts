import {
  branchesChanged,
  type BranchObservation,
  type BranchesObserved,
  type RunId,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type { BranchSet } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { newKey, type RemoteCalls } from '../calls/remote-calls'

export type BranchRecorder = {
  append(args: { threadId: ThreadId; runId: RunId; body: BranchesObserved }): Promise<unknown>
  events(): readonly V2Event[]
}

export type BranchObserverArgs = {
  record: BranchRecorder
  remoteCalls: RemoteCalls
  threadId: ThreadId
  repos(): Promise<readonly string[]>
  runId(): RunId
  log?: LogPort | undefined
}

const observationOf = (set: BranchSet): BranchObservation => ({
  repo: set.repoPath,
  head: set.head,
  branches: set.branches,
  worktrees: set.worktrees,
})

export class BranchObserver {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly args: BranchObserverArgs) {}

  start(): () => void {
    return this.args.remoteCalls.onEvent((frame) => {
      if (frame.event.type !== 'git.branches') return
      const set = frame.event.set
      void this.enqueue(() => this.observe(set))
    })
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => {
      const repos = await this.args.repos()
      for (const repo of repos) {
        const result = await this.args.remoteCalls.invoke({
          key: newKey(),
          op: { op: 'git.read', repoPath: repo },
        })
        if (result.status === 'ok' && result.op === 'git.read') {
          await this.observe(result.value)
        }
      }
    })
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(() => this.guarded(task))
    this.tail = run
    return run
  }

  private async guarded(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      this.args.log?.error({
        source: 'holder.branches',
        message: 'branch observation failed',
        ...logFieldsOf({ error }),
      })
    }
  }

  private async observe(set: BranchSet): Promise<void> {
    const observation = observationOf(set)
    if (!branchesChanged({ events: this.args.record.events(), set: observation })) return
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      body: { type: 'branches-observed', ...observation },
    })
  }
}
