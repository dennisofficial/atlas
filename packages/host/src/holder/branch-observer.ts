import {
  canonicalObservation,
  observationChanged,
  type BranchObservation,
  type BranchesObserved,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import type { BranchSet } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { newKey, systemTimers, type RemoteCalls } from '../calls/remote-calls'
import type { HostTimers } from './ports'

const REFRESH_TIMEOUT_MS = 10_000

type ObserverTimers = Pick<HostTimers, 'setTimeout' | 'clearTimeout'>

export type BranchRecorder = {
  append(args: { threadId: ThreadId; runId: RunId; body: BranchesObserved }): Promise<unknown>
  lastObservation(repo: string): BranchObservation | undefined
  recordedBase(repo: string): string | undefined
}

export type BranchObserverArgs = {
  record: BranchRecorder
  remoteCalls: RemoteCalls
  threadId: ThreadId
  signal: AbortSignal
  repos(): Promise<readonly string[]>
  onRepo?: ((listener: (repoPath: string) => void) => () => void) | undefined
  baseOf(repo: string): string | null
  afterRefresh?: (() => Promise<void>) | undefined
  runId(): RunId
  timers?: ObserverTimers | undefined
  log?: LogPort | undefined
}

const observationOf = (set: BranchSet): BranchObservation => ({
  repo: set.repoPath,
  head: set.head,
  branches: set.branches,
  worktrees: set.worktrees,
  remotes: set.remotes,
  checkouts: set.checkouts,
})

export class BranchObserver {
  private tail: Promise<void> = Promise.resolve()
  private readonly stopped = new AbortController()
  private readonly recorded = new Map<string, string>()
  private unsubscribe: (() => void) | undefined
  private unsubscribeRepos: (() => void) | undefined

  private readonly timers: ObserverTimers

  constructor(private readonly args: BranchObserverArgs) {
    this.timers = args.timers ?? systemTimers
  }

  start(): Promise<void> {
    this.unsubscribe = this.args.remoteCalls.onEvent((frame) => {
      if (frame.event.type !== 'git.branches') return
      const set = frame.event.set
      void this.enqueue(() => this.observe(set))
    })
    this.unsubscribeRepos = this.args.onRepo?.((repoPath) => {
      void this.enqueue(() => this.readRepo(repoPath))
    })
    return this.refreshRepos()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.unsubscribeRepos?.()
    this.unsubscribeRepos = undefined
    this.stopped.abort()
  }

  async refresh(): Promise<void> {
    await this.refreshRepos()
    if (!this.isStopped) await this.args.afterRefresh?.()
  }

  private refreshRepos(): Promise<void> {
    return this.enqueue(async () => {
      for (const repo of await this.args.repos()) await this.readRepo(repo)
    })
  }

  private async readRepo(repoPath: string): Promise<void> {
    const key = newKey()
    const result = await this.args.remoteCalls.invoke({
      key,
      op: { op: 'git.read', repoPath },
    })
    await this.ackQuietly(key)
    if (result.status === 'ok' && result.op === 'git.read') await this.observe(result.value)
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
        this.timers.clearTimeout(timer)
        for (const signal of signals) signal.removeEventListener('abort', finish)
      }
      const finish = (): void => {
        cleanup()
        resolve()
      }
      const timer = this.timers.setTimeout(finish, REFRESH_TIMEOUT_MS)
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
    const base = this.baseOf(observation.repo)
    const stamped = base === null ? observation : { ...observation, base }
    const canonical = canonicalObservation(stamped)
    if (this.recorded.get(observation.repo) === canonical) return
    if (!observationChanged({ last, set: stamped })) {
      this.recorded.set(observation.repo, canonical)
      return
    }
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      body: { type: 'branches-observed', ...stamped },
    })
    this.recorded.set(observation.repo, canonical)
  }

  private baseOf(repo: string): string | null {
    return this.args.baseOf(repo) ?? this.args.record.recordedBase(repo) ?? null
  }
}
