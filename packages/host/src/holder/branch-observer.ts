import {
  observationChanged,
  type BranchObservation,
  type BranchesObserved,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import type { BranchSet } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { newKey, type RemoteCalls } from '../calls/remote-calls'

const REFRESH_TIMEOUT_MS = 10_000

export type BranchRecorder = {
  append(args: { threadId: ThreadId; runId: RunId; body: BranchesObserved }): Promise<unknown>
  lastObservation(repo: string): BranchObservation | undefined
}

export type BranchObserverArgs = {
  record: BranchRecorder
  remoteCalls: RemoteCalls
  threadId: ThreadId
  signal: AbortSignal
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
  private readonly stopped = new AbortController()
  private unsubscribe: (() => void) | undefined

  constructor(private readonly args: BranchObserverArgs) {}

  start(): void {
    this.unsubscribe = this.args.remoteCalls.onEvent((frame) => {
      if (frame.event.type !== 'git.branches') return
      const set = frame.event.set
      void this.enqueue(() => this.observe(set))
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.stopped.abort()
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => {
      const repos = await this.args.repos()
      for (const repo of repos) {
        const key = newKey()
        const result = await this.args.remoteCalls.invoke({
          key,
          op: { op: 'git.read', repoPath: repo },
        })
        await this.ackQuietly(key)
        if (result.status === 'ok' && result.op === 'git.read') {
          await this.observe(result.value)
        }
      }
    })
  }

  private get isStopped(): boolean {
    return this.stopped.signal.aborted
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    if (this.isStopped) return Promise.resolve()
    const run = this.tail.then(() => this.bounded(task))
    this.tail = run
    return run
  }

  private bounded(task: () => Promise<void>): Promise<void> {
    const signals = [this.args.signal, this.stopped.signal]
    return new Promise<void>((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        for (const signal of signals) signal.removeEventListener('abort', finish)
      }
      const finish = (): void => {
        cleanup()
        resolve()
      }
      const timer = setTimeout(finish, REFRESH_TIMEOUT_MS)
      if (this.isStopped || signals.some((signal) => signal.aborted)) {
        finish()
        return
      }
      for (const signal of signals) signal.addEventListener('abort', finish, { once: true })
      void this.guarded(task).then(finish)
    })
  }

  private async guarded(task: () => Promise<void>): Promise<void> {
    try {
      if (this.isStopped) return
      await task()
    } catch (error) {
      this.args.log?.error({
        source: 'holder.branches',
        message: 'branch observation failed',
        ...logFieldsOf({ error }),
      })
    }
  }

  private async ackQuietly(key: string): Promise<void> {
    try {
      await this.args.remoteCalls.ack({ key })
    } catch (error) {
      this.args.log?.error({
        source: 'holder.branches',
        message: `ack for ${key} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }

  private async observe(set: BranchSet): Promise<void> {
    if (this.isStopped) return
    const observation = observationOf(set)
    const last = this.args.record.lastObservation(observation.repo)
    if (!observationChanged({ last, set: observation })) return
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      body: { type: 'branches-observed', ...observation },
    })
  }
}
