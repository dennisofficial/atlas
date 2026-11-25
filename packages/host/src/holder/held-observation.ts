import type { ThreadId } from '@dltech/atlas-core'

import { DaemonProcessPort } from '../calls/ports/process'
import type { BranchObserver } from './branch-observer'
import { type ChangesCheckout, ChangesSnapshotter, ESnapshotTrigger } from './changes/snapshotter'
import { runGit } from './checkouts/git'
import { ContextMirror } from './context/context-mirror'
import type { OomObserver } from './oom-observer'
import type { PodSampleObserver } from './pod-sample-observer'
import { logDriveFault } from './held-runner'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export const OBSERVATION_STOP_DEADLINE_MS = 10_000

const createChangesSnapshotter = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
}): ChangesSnapshotter | undefined => {
  const { deps } = args
  const content = deps.changes?.content
  if (content === undefined) return undefined
  const processes = new DaemonProcessPort({ calls: args.runtime.remoteCalls })
  return new ChangesSnapshotter({
    sessionId: deps.sessionId,
    plane: deps.plane,
    content,
    remoteCalls: args.runtime.remoteCalls,
    checkouts: async () => {
      if (!args.record.eventCache().bookkeeping().workspace().prepared) return []
      const checkoutPaths = await args.runtime.watchedCheckouts()
      const found: ChangesCheckout[] = []
      for (const repoPath of checkoutPaths) {
        const origin = await runGit({
          processes,
          cwd: repoPath,
          argv: ['remote', 'get-url', 'origin'],
        })
        found.push({
          repoPath,
          originUrl: origin.ok ? origin.stdout.trim() : '',
          base: args.runtime.baseBranchOf(repoPath),
        })
      }
      return found
    },
    ...(deps.log === undefined ? {} : { log: deps.log }),
    now: () => deps.timers.now(),
  })
}

const createContextMirror = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
}): ContextMirror | undefined => {
  const { deps } = args
  const context = deps.contextMirror
  if (context === undefined) return undefined
  return new ContextMirror({
    sessionId: deps.sessionId,
    root: context.contextDir(deps.sessionId),
    plane: deps.plane,
    content: context.content,
    remoteCalls: args.runtime.remoteCalls,
    announce: async (paths) => {
      await args.record.append({
        threadId: args.threadId,
        runId: deps.ids.nextRunId(),
        drafts: [{ type: 'context-changed', paths: [...paths] }],
      })
    },
    ...(deps.log === undefined ? {} : { log: deps.log }),
    now: () => deps.timers.now(),
  })
}

export class HeldObservation {
  private readonly deps: HeldSessionDeps
  private readonly runtime: SessionRuntime
  private readonly branches: BranchObserver
  private readonly oom: OomObserver | undefined
  private readonly podSamples: PodSampleObserver | undefined
  private readonly changes: ChangesSnapshotter | undefined
  private readonly context: ContextMirror | undefined
  private unsubscribeCheckouts: (() => void) | undefined

  constructor(args: {
    deps: HeldSessionDeps
    runtime: SessionRuntime
    record: SessionRecord
    threadId: ThreadId
    branches: BranchObserver
    oom?: OomObserver | undefined
    podSamples?: PodSampleObserver | undefined
  }) {
    this.deps = args.deps
    this.runtime = args.runtime
    this.branches = args.branches
    this.oom = args.oom
    this.podSamples = args.podSamples
    this.changes = createChangesSnapshotter(args)
    this.context = createContextMirror(args)
  }

  get observer(): BranchObserver {
    return this.branches
  }

  start(): void {
    this.unsubscribeCheckouts = this.runtime.onCheckout?.(() => this.changes?.rearm())
    this.changes?.start()
    this.context?.start()
  }

  turnStarted(): Promise<void> {
    return this.podSamples?.turnStarted() ?? Promise.resolve()
  }

  async turnEnded(): Promise<void> {
    void this.changes?.snapshotNow(ESnapshotTrigger.TurnEnd)
    void this.context?.rescanNow()
    await this.podSamples?.turnEnded()
  }

  refreshBranches(): void {
    void this.branches.refresh().catch((error: unknown) => this.faulted(error))
  }

  drain(): void {
    this.branches.stop()
    this.oom?.stop()
    void this.podSamples?.stop()
    this.releaseCheckouts()
    void this.changes?.stop()
    void this.context?.stop()
  }

  async stop(): Promise<void> {
    this.branches.stop()
    this.oom?.stop()
    void this.podSamples?.stop()
    this.releaseCheckouts()
    await this.withinStopDeadline(this.stopping())
  }

  private stopping(): Promise<void> {
    const stopping = [this.changes?.stop(), this.context?.stop()].filter(
      (stopping): stopping is Promise<void> => stopping !== undefined,
    )
    if (stopping.length === 0) return Promise.resolve()
    return Promise.all(
      stopping.map((work) => work.catch((error: unknown) => this.faulted(error))),
    ).then(() => undefined)
  }

  private withinStopDeadline(stopping: Promise<void>): Promise<void> {
    const { timers, log, sessionId } = this.deps
    return new Promise<void>((resolve) => {
      const timer = timers.setTimeout(() => {
        log?.warn({
          source: 'holder.observation',
          message: `stopping the observations of ${sessionId} passed ${OBSERVATION_STOP_DEADLINE_MS}ms; the lease is settled without them`,
          data: { sessionId },
        })
        resolve()
      }, OBSERVATION_STOP_DEADLINE_MS)
      void stopping.then(() => {
        timers.clearTimeout(timer)
        resolve()
      })
    })
  }

  async observeBeforeRelease(): Promise<void> {
    this.changes?.quiesce()
    await this.context?.rescanNow().catch((error: unknown) => this.faulted(error))
    this.context?.quiesce()
    await this.branches.refresh().catch((error: unknown) => this.faulted(error))
  }

  private releaseCheckouts(): void {
    this.unsubscribeCheckouts?.()
    this.unsubscribeCheckouts = undefined
  }

  private faulted(error: unknown): void {
    logDriveFault({ deps: this.deps, error })
  }
}
