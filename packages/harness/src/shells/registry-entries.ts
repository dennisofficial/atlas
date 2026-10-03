import { EShellStatus, type ThreadId } from '@dltech/atlas-core'

import { SIGKILL_GRACE_MS } from '../execution/local-process'
import { ShellAttentionQueue } from './attention'
import type { BackgroundShell, SettledShellOutcome, StartedShellOutcome } from './background-shell'
import type { ShellEventJournal } from './journal'
import type { ShellId } from './shell-id'

export const RETAINED_ENDED_SHELLS = 50
export const ACTIVITY_NOTIFY_MS = 100
export const PROMPT_SETTLE_MS = 2_000
export const SILENT_FOR_AT_MOST_MS = 1_800_000
export const KILL_SETTLE_MS = SIGKILL_GRACE_MS + 2_000

export type Tracked = {
  shell: BackgroundShell
  threadId: ThreadId
  pattern?: string | undefined
  announced: boolean
  reaped: boolean
}

export const unknownShell = (args: { shellId: string; known: readonly ShellId[] }): string => {
  const known = args.known.length === 0 ? 'none is running' : args.known.join(', ')
  return `no background shell is registered as "${args.shellId}"; known shells: ${known}`
}

export enum EShellShutdownIntent {
  Close = 'close',
  Detach = 'detach',
}

export class RegistryState {
  readonly tracked = new Map<ShellId, Tracked>()
  readonly endings = new Map<ShellId, Promise<SettledShellOutcome>>()
  readonly pendingKills = new Map<ShellId, (outcome: Promise<SettledShellOutcome>) => void>()
  readonly endingSettlements = new Set<Promise<void>>()
  readonly settledListeners = new Set<() => void>()
  readonly listeners = new Set<() => void>()
  readonly releases = new Map<ShellId, () => void>()
  readonly notices = new ShellAttentionQueue()
  closed = false
  shutdownIntent: EShellShutdownIntent | undefined
  shutdown: Promise<void> | undefined
  readonly pendingStarts = new Set<Promise<StartedShellOutcome>>()
  readonly failedEndings = new Set<ShellId>()
  private revision = 0
  private flushQueued = false
  private activityTimer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly journal: ShellEventJournal | undefined) {}

  admitStart(start: () => Promise<StartedShellOutcome>): Promise<StartedShellOutcome> {
    if (this.closed || this.shutdownIntent !== undefined) {
      return Promise.resolve({ ok: false, reason: 'this shell registry is closed and will never start another shell' })
    }
    const pending = Promise.resolve().then(start)
    this.pendingStarts.add(pending)
    const remove = (): void => { this.pendingStarts.delete(pending) }
    void pending.then(remove, remove)
    return pending
  }

  version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  bump(): void {
    this.revision += 1
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      this.flush()
    })
  }

  noteActivity(): void {
    this.revision += 1
    if (this.flushQueued || this.activityTimer !== null) return
    this.activityTimer = setTimeout(() => {
      this.activityTimer = null
      this.flush()
    }, ACTIVITY_NOTIFY_MS)
    this.activityTimer.unref?.()
  }

  settling(): boolean {
    if (this.endingSettlements.size > 0) return true
    if (this.failedEndings.size > 0) return true
    return [...this.tracked.values()].some(
      (entry) => entry.shell.snapshot().status !== EShellStatus.Running && !entry.reaped,
    )
  }

  announceSettled(): void {
    for (const listener of [...this.settledListeners]) listener()
  }

  idsOf(threadId: ThreadId): readonly ShellId[] {
    return [...this.tracked.entries()]
      .filter(([, entry]) => entry.threadId === threadId)
      .map(([id]) => id)
  }

  entryFor(args: { shellId: string; threadId: ThreadId }): Tracked | undefined {
    for (const [id, entry] of this.tracked) {
      if (id !== args.shellId || entry.threadId !== args.threadId) continue
      if (entry.reaped) {
        this.tracked.delete(id)
        this.tracked.set(id, entry)
      }
      return entry
    }
    return undefined
  }

  releaseAssertion(shellId: ShellId): void {
    this.releases.get(shellId)?.()
    this.releases.delete(shellId)
  }

  noteReaped(shellId: ShellId): void {
    const entry = this.tracked.get(shellId)
    if (entry === undefined) return
    this.tracked.delete(shellId)
    this.tracked.set(shellId, entry)

    const reaped = [...this.tracked.entries()].filter(
      ([id, held]) => held.reaped && !this.failedEndings.has(id),
    )
    let excess = reaped.length - RETAINED_ENDED_SHELLS
    for (const [id, held] of reaped) {
      if (excess <= 0) return
      this.tracked.delete(id)
      void held.shell.detach()
      excess -= 1
    }
  }

  stopTimers(): void {
    if (this.activityTimer !== null) clearTimeout(this.activityTimer)
    this.activityTimer = null
    this.listeners.clear()
    this.settledListeners.clear()
  }

  private flush(): void {
    for (const listener of this.listeners) listener()
  }
}

export async function withinDeadline(args: { promise: Promise<unknown>; ms: number }): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), args.ms)
    timer.unref?.()
  })
  const finished = await Promise.race([args.promise.then(() => true as const), expired])
  clearTimeout(timer)
  return finished
}
