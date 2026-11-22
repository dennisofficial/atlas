import { DaemonProcessPort } from '../calls/ports/process'
import type { BranchObserver } from './branch-observer'
import { type ChangesCheckout, ChangesSnapshotter, ESnapshotTrigger } from './changes/snapshotter'
import { runGit } from './checkouts/git'
import type { DiskPressureObserver } from './disk-pressure-observer'
import { logDriveFault } from './held-runner'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

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

export class HeldObservation {
  private readonly deps: HeldSessionDeps
  private readonly runtime: SessionRuntime
  private readonly branches: BranchObserver
  private readonly diskPressure: DiskPressureObserver | undefined
  private readonly changes: ChangesSnapshotter | undefined
  private unsubscribeCheckouts: (() => void) | undefined

  constructor(args: {
    deps: HeldSessionDeps
    runtime: SessionRuntime
    record: SessionRecord
    branches: BranchObserver
    diskPressure?: DiskPressureObserver | undefined
  }) {
    this.deps = args.deps
    this.runtime = args.runtime
    this.branches = args.branches
    this.diskPressure = args.diskPressure
    this.changes = createChangesSnapshotter(args)
  }

  get observer(): BranchObserver {
    return this.branches
  }

  start(): void {
    this.unsubscribeCheckouts = this.runtime.onCheckout?.(() => this.changes?.rearm())
    this.changes?.start()
  }

  turnEnded(): void {
    void this.changes?.snapshotNow(ESnapshotTrigger.TurnEnd)
  }

  refreshBranches(): void {
    void this.branches.refresh().catch((error: unknown) => this.faulted(error))
  }

  drain(): void {
    this.branches.stop()
    this.diskPressure?.stop()
    this.releaseCheckouts()
    void this.changes?.stop()
  }

  async stop(): Promise<void> {
    this.branches.stop()
    this.diskPressure?.stop()
    this.releaseCheckouts()
    await this.changes?.stop().catch((error: unknown) => this.faulted(error))
  }

  async observeBeforeRelease(): Promise<void> {
    this.changes?.quiesce()
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
