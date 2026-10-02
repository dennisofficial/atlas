import { EShellStatus, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import type { ShellDelta } from './background-shell'

import type { InputBatch } from '../intake/input-batch'
import type { ShellSnapshot } from './background-shell'
import { awaitingInputDraft, matchedDraft, stillRunningDraft } from './notifications'
import type { MatchedLines } from './shell-watch'
import { DELIVERED_CHARACTERS, previewDelta, take } from './output-preview'

export { DELIVERED_CHARACTERS, previewDelta, take }
export type { Tracked } from './output-preview'

export enum ENotice {
  Ended = 'ended',
  AwaitingInput = 'awaiting-input',
  Matched = 'matched',
  StillRunning = 'still-running',
}

type NoticedShell = { snapshot: ShellSnapshot; threadId: ThreadId }

/**
 * The queue is a wake-up bell, not a store. An ending carries no output: the event log is the only
 * announcement channel for a shell ending, written at occurrence by the registry, so a drained
 * `Ended` notice yields no `background-shell-ended` draft — it exists purely to wake whoever is
 * listening and to hold a pending row until acknowledged.
 *
 * A match carries its lines instead of a delta: the matcher accumulates separately from the
 * delivery cursor, so nothing about a match is read out of the shell's undelivered output.
 */
export type ShellNotice =
  | (NoticedShell & { kind: ENotice.Ended })
  | (NoticedShell & {
      kind: ENotice.AwaitingInput
      take: () => ShellDelta
    })
  | (NoticedShell & { kind: ENotice.Matched; pattern: string; matched: MatchedLines })
  | (NoticedShell & {
      kind: ENotice.StillRunning
      peek: () => string
      runningForMs: number
      silentForMs: number
      checkInMs: number
    })

/**
 * A pending row must know which kind of notice it is: a still-running shell announced as
 * "waiting on input" would send the operator to answer a prompt that does not exist.
 */
export type PendingShellNotice = { kind: ENotice; snapshot: ShellSnapshot }

const NOTHING_ANNOUNCED: readonly PendingShellNotice[] = Object.freeze([])

export const NOTHING_DRAINED: readonly EventDraft[] = Object.freeze([])

const NOTHING_NOTICED: ReadonlyMap<ThreadId, readonly PendingShellNotice[]> = new Map()

export class ShellNoticeQueue {
  private queued: readonly ShellNotice[] = []
  private noticed: ReadonlyMap<ThreadId, readonly PendingShellNotice[]> = NOTHING_NOTICED
  private readonly listeners = new Set<() => void>()

  constructor(private readonly live: (args: { shellId: string }) => ShellSnapshot | undefined) {}

  /**
   * Check-ins arrive on a cadence whether or not the last one was drained, so an undrained one is
   * replaced by its fresher successor rather than stacked behind it.
   */
  queue(notice: ShellNotice): void {
    const kept =
      notice.kind === ENotice.StillRunning
        ? this.queued.filter(
            (held) =>
              held.kind !== ENotice.StillRunning ||
              held.snapshot.shellId !== notice.snapshot.shellId,
          )
        : this.queued
    this.settle([...kept, notice])
  }

  /**
   * An awaiting-input notice is dropped if the shell ended before it was handed over: the prompt
   * stopped being the reason nothing is coming, and the ending queued behind it carries the output.
   */
  drain({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    const batch = this.prepare({ threadId })
    batch.acknowledge()
    return batch.drafts
  }

  prepare({ threadId }: { threadId: ThreadId }): InputBatch {
    const captured = this.queued.filter((notice) => notice.threadId === threadId)
    const drafts = captured
      .filter((notice) => this.stillWorthTelling(notice))
      .flatMap((notice) => this.draftsOf(notice))

    let acknowledged = false
    const acknowledge = (): void => {
      if (acknowledged) return
      acknowledged = true
      const leaving = new Set(captured)
      const kept = this.queued.filter((notice) => !leaving.has(notice))
      if (kept.length !== this.queued.length) this.settle(kept)
    }

    const wakesTurn =
      drafts.length > 0 ||
      captured.some((notice) => notice.kind === ENotice.Ended && this.stillWorthTelling(notice))
    return { drafts, wakesTurn, acknowledge }
  }

  pending({ threadId }: { threadId: ThreadId }): readonly PendingShellNotice[] {
    return this.noticed.get(threadId) ?? NOTHING_ANNOUNCED
  }

  dropShells({ threadId, shellIds }: { threadId: ThreadId; shellIds: readonly string[] }): void {
    if (this.queued.length === 0 || shellIds.length === 0) return
    this.settle(
      this.queued.filter(
        (notice) =>
          notice.threadId !== threadId || !shellIds.includes(notice.snapshot.shellId),
      ),
    )
  }

  threadsAwaiting(): readonly ThreadId[] {
    return [...this.noticed.keys()]
  }

  threadsQueued(): readonly ThreadId[] {
    return [...new Set(this.queued.map((notice) => notice.threadId))]
  }

  hasNoticesFor({ shellId }: { shellId: string }): boolean {
    return this.queued.some((notice) => notice.snapshot.shellId === shellId)
  }

  onNotice(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  forget({ threadId }: { threadId: ThreadId }): void {
    const kept = this.queued.filter((notice) => notice.threadId !== threadId)
    if (kept.length === this.queued.length) return

    this.settle(kept)
  }

  /**
   * A notice claiming a shell is alive is dead on arrival when the shell is not: the ending
   * queued beside it already says so. Endings themselves always pass — they are the ending.
   */
  private stillWorthTelling(notice: ShellNotice): boolean {
    if (notice.kind === ENotice.Ended) return true

    const live = this.live({ shellId: notice.snapshot.shellId })
    if (notice.kind === ENotice.StillRunning) {
      return live !== undefined && live.status === EShellStatus.Running
    }
    return live === undefined || live.status === EShellStatus.Running
  }

  private draftsOf(notice: ShellNotice): readonly EventDraft[] {
    if (notice.kind === ENotice.Matched) {
      return [
        matchedDraft({
          snapshot: notice.snapshot,
          pattern: notice.pattern,
          matched: notice.matched,
        }),
      ]
    }

    if (notice.kind === ENotice.StillRunning) {
      return [
        stillRunningDraft({
          snapshot: notice.snapshot,
          tail: notice.peek(),
          runningForMs: notice.runningForMs,
          silentForMs: notice.silentForMs,
          checkInMs: notice.checkInMs,
        }),
      ]
    }

    if (notice.kind === ENotice.AwaitingInput) {
      return [awaitingInputDraft({ snapshot: notice.snapshot, delta: notice.take() })]
    }

    // An ending rings the bell and writes nothing: its event is already in the log from the
    // settle path, so a drained ending yields no draft of its own.
    return []
  }

  /**
   * The snapshots are held rather than derived per call: pending backs a React external store,
   * which reads it on every render and requires a stable value between changes.
   */
  private settle(notices: readonly ShellNotice[]): void {
    this.queued = notices

    const byThread = new Map<ThreadId, PendingShellNotice[]>()
    for (const notice of notices) {
      const held = byThread.get(notice.threadId)
      const pending: PendingShellNotice = { kind: notice.kind, snapshot: notice.snapshot }
      if (held === undefined) byThread.set(notice.threadId, [pending])
      else held.push(pending)
    }
    this.noticed = byThread

    for (const listener of [...this.listeners]) listener()
  }
}
