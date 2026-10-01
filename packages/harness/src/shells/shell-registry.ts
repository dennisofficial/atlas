import {
  ClockPort,
  EKilledBy,
  EShellStatus,
  EventLogPort,
  IdPort,
  LogPort,
  ProcessPort,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { LocalProcessPort } from '../execution/local-process'
import type { HookChainSource } from '../hooks/registry'
import type { InputBatch } from '../intake/input-batch'
import type { SleepPrevention } from '../power/sleep-prevention'
import { afterShellDrafts } from './after-shell'
import { bootId } from './boot'
import {
  startBackgroundShell,
  type BackgroundShell,
  type SettledShellOutcome,
  type ShellDelta,
  type ShellKillOutcome,
  type ShellSnapshot,
  type StartedShellOutcome,
  type StartShellArgs,
} from './background-shell'
import { endedDraft } from './notifications'
import { ENotice, ShellNoticeQueue, type PendingShellNotice, type Tracked } from './notice-queue'
import { captureEnding, consumeEndingDelta, previewDelta, take, takeAfterEnding } from './output-preview'
import { toShellId, type ShellId } from './shell-id'
import { SIGKILL_GRACE_MS } from './shell-process'
import { compileWatch, MATCH_SETTLE_MS, MATCHED_LINES_CAP, type MatchedLines } from './shell-watch'

export const RETAINED_CHARACTERS = 400_000
export const RETAINED_ENDED_SHELLS = 50
export const ACTIVITY_NOTIFY_MS = 100
export const OVERFLOW_CHARACTERS = 50_000_000
export const PROMPT_SETTLE_MS = 2_000
export const CHECK_IN_TAIL_CHARACTERS = 1_000
export const SILENT_FOR_AT_MOST_MS = 1_800_000

/** SIGKILL plus the read grace and slack: a kill that outlives this is handed back to the announcement path. */
export const KILL_SETTLE_MS = SIGKILL_GRACE_MS + 2_000

const withinDeadline = async (args: {
  promise: Promise<unknown>
  ms: number
}): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), args.ms)
    timer.unref?.()
  })
  const finished = await Promise.race([args.promise.then(() => true as const), expired])
  clearTimeout(timer)
  return finished
}

export type ShellReadOutcome =
  | { ok: true; snapshot: ShellSnapshot; delta: ShellDelta }
  | { ok: false; reason: string }

/**
 * A shell belongs to the thread that started it. Every read is scoped to an owner so a conversation
 * is never told about, nor able to kill, a shell another conversation is running; only the exit
 * guard and teardown look across all of them, because a process dying kills them all regardless.
 */
export abstract class ShellRegistryPort {
  abstract start(args: StartShellArgs): StartedShellOutcome
  abstract read(args: { shellId: string; threadId: ThreadId }): ShellReadOutcome
  abstract peek(args: {
    shellId: string
    characters: number
    threadId: ThreadId
  }): string | undefined
  /**
   * Signals the shell and returns immediately. When the registry was built with an event log the
   * ending is appended at occurrence regardless of who signalled; the caller that wants to see the
   * death in-band awaits `settled`, which is a read of the death that the log records, never the
   * delivery of it. `by: Model` is the signal the shell_kill tool sends; any other `by` announces
   * through the log alone and hands back no `settled`.
   */
  abstract kill(args: { shellId: string; by: EKilledBy; threadId: ThreadId }): ShellKillOutcome
  /**
   * A caller that just killed shells is already waiting, so the endings it caused should sit in
   * the notice queue when it moves on: an exit that lands after the caller's next drain would hang
   * in the queue for a whole model step. Waits, bounded per shell by `ms`, for every signalled
   * shell of the thread to record its exit and for its ending to land in the log, and answers how
   * many shells had not exited — their endings announce whenever they do, the same as any other
   * ending.
   */
  abstract awaitEndings(args: { threadId: ThreadId; ms: number }): Promise<number>
  /**
   * A rewind disowns the shells it cut: they die with the transcript that started them, and their
   * endings announce nothing — the rewound thread holds no tool call the announcement could
   * belong to. Removal is the one exception to every ending writing itself into the log.
   */
  abstract removeShells(args: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): void
  abstract list(args: { threadId: ThreadId }): readonly ShellSnapshot[]
  abstract listEverywhere(): readonly ShellSnapshot[]
  abstract version(): number
  abstract subscribe(listener: () => void): () => void
  abstract drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
  prepareNotifications?(args: { threadId: ThreadId }): InputBatch
  abstract pendingNotices(args: { threadId: ThreadId }): readonly PendingShellNotice[]
  abstract threadsAwaitingNotice(): readonly ThreadId[]
  threadsWithPendingInput?(): readonly ThreadId[]
  abstract onNotice(listener: () => void): () => void
  abstract forgetNotices(args: { threadId: ThreadId }): void
  abstract closeAll(): Promise<void>
}

const unknownShell = (args: { shellId: string; known: readonly ShellId[] }): string => {
  const known = args.known.length === 0 ? 'none is running' : args.known.join(', ')
  return `no background shell is registered as "${args.shellId}"; known shells: ${known}`
}

export class BunShellRegistry extends ShellRegistryPort {
  private readonly tracked = new Map<ShellId, Tracked>()
  private readonly endings = new Map<ShellId, Promise<SettledShellOutcome>>()
  private readonly pendingKills = new Map<ShellId, (outcome: Promise<SettledShellOutcome>) => void>()
  private readonly notices = new ShellNoticeQueue(({ shellId }) =>
    this.tracked.get(toShellId(shellId))?.shell.snapshot(),
  )
  private readonly settling = new Set<Promise<void>>()
  private started = 0

  private revision = 0
  private readonly listeners = new Set<() => void>()
  private flushQueued = false
  private activityTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly root: string,
    private readonly clock: ClockPort,
    private readonly hooks: HookChainSource,
    private readonly processes: ProcessPort = new LocalProcessPort(),
    private readonly sleepPrevention?: SleepPrevention,
    private readonly log?: EventLogPort,
    private readonly ids?: IdPort,
    private readonly silenceMs: number = SILENT_FOR_AT_MOST_MS,
    private readonly operations?: LogPort,
  ) {
    super()
  }

  start(args: StartShellArgs): StartedShellOutcome {
    const watch = compileWatch(args.watch)
    if (!watch.ok) return watch

    this.started += 1
    const shellId = toShellId(`bash_${this.started}`)
    const checkInMs = args.checkInMs

    const opened = startBackgroundShell({
      shellId,
      bootId,
      command: args.command,
      description: args.description,
      cwd: args.cwd ?? this.root,
      threadId: args.threadId,
      clock: this.clock,
      retainCharacters: RETAINED_CHARACTERS,
      overflowCharacters: OVERFLOW_CHARACTERS,
      promptSettleMs: PROMPT_SETTLE_MS,
      watch: watch.pattern,
      matchSettleMs: MATCH_SETTLE_MS,
      matchedLinesCap: MATCHED_LINES_CAP,
      timeoutMs: args.timeoutMs,
      silenceMs: this.silenceMs,
      checkInMs,
      exposure: args.exposure,
      processes: this.processes,
      onExit: (shell) => this.announceExit(shell),
      onSettled: (shellId) => this.captureOutput(shellId),
      onAwaitingInput: (shell) => this.announceAwaitingInput(shell),
      onMatched: (matched) => this.announceMatched(matched),
      onStillRunning: (shell) => {
        if (checkInMs === undefined) return
        this.announceStillRunning({ shell, checkInMs })
      },
      onActivity: () => this.noteActivity(),
    })
    if (!opened.ok) return opened

    const releaseSleepAssertion = this.sleepPrevention?.acquire()
    if (releaseSleepAssertion !== undefined) {
      void opened.shell.exited.then(
        () => releaseSleepAssertion(),
        () => releaseSleepAssertion(),
      )
    }

    this.tracked.set(shellId, {
      shell: opened.shell,
      cursor: 0,
      announced: false,
      reaped: false,
      threadId: args.threadId,
      pattern: args.watch,
      onReaped: () => this.noteReaped(shellId),
    })
    this.bump()

    return { ok: true, snapshot: opened.shell.snapshot() }
  }

  version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private flush(): void {
    for (const listener of this.listeners) listener()
  }

  /** Structural changes (start, exit, awaiting input) flush on the microtask, coalesced. */
  private bump(): void {
    this.revision += 1
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      this.flush()
    })
  }

  /** Output arrives per chunk; a chatty shell must not wake a listener per chunk. */
  private noteActivity(): void {
    this.revision += 1
    if (this.flushQueued || this.activityTimer !== null) return
    this.activityTimer = setTimeout(() => {
      this.activityTimer = null
      this.flush()
    }, ACTIVITY_NOTIFY_MS)
    this.activityTimer.unref?.()
  }

  read({ shellId, threadId }: { shellId: string; threadId: ThreadId }): ShellReadOutcome {
    const entry = this.entryFor({ shellId, threadId })
    if (entry === undefined) {
      return { ok: false, reason: unknownShell({ shellId, known: this.idsOf(threadId) }) }
    }

    return { ok: true, snapshot: entry.shell.snapshot(), delta: takeAfterEnding(entry) }
  }

  /**
   * The cursor belongs to the model's reading of a shell, so a human looking at the same shell in
   * the sidebar must not advance it.
   */
  peek({
    shellId,
    characters,
    threadId,
  }: {
    shellId: string
    characters: number
    threadId: ThreadId
  }): string | undefined {
    return this.entryFor({ shellId, threadId })?.shell.tail(characters)
  }

  kill({
    shellId,
    by,
    threadId,
  }: {
    shellId: string
    by: EKilledBy
    threadId: ThreadId
  }): ShellKillOutcome {
    const entry = this.entryFor({ shellId, threadId })
    if (entry === undefined) {
      return { ok: false, reason: unknownShell({ shellId, known: this.idsOf(threadId) }) }
    }

    const wasRunning = entry.shell.snapshot().status === EShellStatus.Running
    entry.shell.kill(by)
    const snapshot = entry.shell.snapshot()

    if (by !== EKilledBy.Model) return { ok: true, snapshot }

    // A shell that was not running when this kill landed signalled nothing. When it is still
    // dying from an earlier signal, the kill joins the ending already on its way; when it had
    // already finished outright, there is no death to wait on and nothing to hand back.
    if (!wasRunning) {
      const inFlight = this.endings.get(entry.shell.shellId)
      const dying = snapshot.status === EShellStatus.Killed || snapshot.status === EShellStatus.Overflowed
      return dying && inFlight !== undefined ? { ok: true, snapshot, settled: inFlight } : { ok: true, snapshot }
    }

    const settled = this.settledOf(entry)
    return settled === undefined ? { ok: true, snapshot } : { ok: true, snapshot, settled }
  }

  /**
   * The settled continuation a model kill is handed. It is a read of the death the occurrence
   * append records, never the recording itself: the append runs from the exit continuation once
   * the process is reaped and its output drained, and this promise waits out the kill deadline for
   * that to happen. `died: false` means the process outlived it, in which case the ending lands
   * when it lands, the same as any other.
   */
  private settledOf(entry: Tracked): Promise<SettledShellOutcome> | undefined {
    const existing = this.endings.get(entry.shell.shellId)
    if (existing !== undefined) return existing

    if (entry.shell.snapshot().status === EShellStatus.Running) return undefined
    if (this.tracked.get(entry.shell.shellId) !== entry) return undefined

    // Register the wait synchronously: a second kill arriving before the process dies must join
    // this same promise, and the settle continuation the exit callback starts later adopts it
    // rather than opening a second ending. The promise resolves to whatever the occurrence append
    // produced — or `died: false` when the process outlives the kill deadline.
    let adopt: ((outcome: Promise<SettledShellOutcome>) => void) | undefined
    const waiting = new Promise<SettledShellOutcome>((resolve) => {
      adopt = (outcome) => void outcome.then(resolve)
      void withinDeadline({ promise: entry.shell.exited, ms: KILL_SETTLE_MS }).then((died) => {
        if (died) return
        // Outlived the kill deadline: the ending lands when it lands. Hand the map back so a
        // later kill waits on the real settle rather than joining this expired wait.
        if (this.endings.get(entry.shell.shellId) === waiting) {
          this.endings.delete(entry.shell.shellId)
        }
        this.pendingKills.delete(entry.shell.shellId)
        resolve({ died: false })
      })
    })
    this.endings.set(entry.shell.shellId, waiting)
    this.pendingKills.set(entry.shell.shellId, (outcome) => adopt?.(outcome))
    return waiting
  }

  async awaitEndings({ threadId, ms }: { threadId: ThreadId; ms: number }): Promise<number> {
    const signalled = [...this.tracked.values()].filter(
      (entry) =>
        entry.threadId === threadId && entry.shell.snapshot().status !== EShellStatus.Running,
    )
    const deaths = await Promise.all(
      signalled.map((entry) =>
        withinDeadline({ promise: entry.shell.exited.catch(() => undefined), ms }),
      ),
    )
    await withinDeadline({ promise: Promise.all([...this.settling]).catch(() => undefined), ms })
    return deaths.filter((died) => !died).length
  }

  removeShells({
    threadId,
    shellIds,
    by,
  }: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): void {
    let removed = false
    for (const shellId of shellIds) {
      const entry = this.entryFor({ shellId, threadId })
      if (entry === undefined) continue
      entry.announced = true
      if (entry.shell.snapshot().status === EShellStatus.Running) {
        entry.shell.kill(by)
        const exited = entry.shell.exited
        this.settling.add(exited)
        void exited.finally(() => void this.settling.delete(exited))
      }
      this.tracked.delete(toShellId(shellId))
      this.endings.delete(toShellId(shellId))
      this.pendingKills.delete(toShellId(shellId))
      removed = true
    }
    if (!removed) return
    this.notices.dropShells({ threadId, shellIds })
    this.bump()
  }

  list({ threadId }: { threadId: ThreadId }): readonly ShellSnapshot[] {
    return [...this.tracked.values()]
      .filter((entry) => entry.threadId === threadId)
      .map((entry) => entry.shell.snapshot())
  }

  listEverywhere(): readonly ShellSnapshot[] {
    return [...this.tracked.values()].map((entry) => entry.shell.snapshot())
  }

  drainNotifications({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    return this.notices.drain({ threadId })
  }

  override prepareNotifications({ threadId }: { threadId: ThreadId }): InputBatch {
    return this.notices.prepare({ threadId })
  }

  pendingNotices({ threadId }: { threadId: ThreadId }): readonly PendingShellNotice[] {
    return this.notices.pending({ threadId })
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return this.notices.threadsAwaiting()
  }

  override threadsWithPendingInput(): readonly ThreadId[] {
    return this.notices.threadsQueued()
  }

  onNotice(listener: () => void): () => void {
    return this.notices.onNotice(listener)
  }

  forgetNotices({ threadId }: { threadId: ThreadId }): void {
    this.notices.forget({ threadId })
  }

  /**
   * Reaping is by spawner rather than by process tree: a shell the model backgrounded outlives the
   * turn by design, so only the session that started it knows when nobody is left to read it.
   * closeAll stops the shells and waits for their endings to land in the log; with the ending
   * appended at occurrence, nothing is left for a teardown drain to reconcile.
   */
  async closeAll(): Promise<void> {
    const running = [...this.tracked.values()]
    for (const entry of running) entry.shell.kill(EKilledBy.SessionEnd)
    await Promise.all(running.map((entry) => entry.shell.exited))
    while (this.settling.size > 0) await Promise.all([...this.settling])
    this.tracked.clear()
    this.endings.clear()
    this.pendingKills.clear()
    if (this.activityTimer !== null) {
      clearTimeout(this.activityTimer)
      this.activityTimer = null
    }
    this.listeners.clear()
  }

  private idsOf(threadId: ThreadId): readonly ShellId[] {
    return [...this.tracked.entries()]
      .filter(([, entry]) => entry.threadId === threadId)
      .map(([id]) => id)
  }

  private entryFor({
    shellId,
    threadId,
  }: {
    shellId: string
    threadId: ThreadId
  }): Tracked | undefined {
    for (const [id, entry] of this.tracked) {
      if (id !== shellId || entry.threadId !== threadId) continue
      if (entry.reaped) {
        this.tracked.delete(id)
        this.tracked.set(id, entry)
      }
      return entry
    }
    return undefined
  }

  private noteReaped(shellId: ShellId): void {
    const entry = this.tracked.get(shellId)
    if (entry === undefined) return
    this.tracked.delete(shellId)
    this.tracked.set(shellId, entry)

    const reaped = [...this.tracked.entries()].filter(([, held]) => held.reaped)
    let excess = reaped.length - RETAINED_ENDED_SHELLS
    for (const [id] of reaped) {
      if (excess <= 0) return
      this.tracked.delete(id)
      excess -= 1
    }
  }

  private announceExit(shell: BackgroundShell): void {
    const entry = this.tracked.get(shell.shellId)
    if (entry === undefined || entry.announced) return

    entry.announced = true
    this.bump()

    this.settle(entry)
  }

  private settle(entry: Tracked): void {
    const adopt = this.pendingKills.get(entry.shell.shellId)
    if (adopt === undefined && this.endings.get(entry.shell.shellId) !== undefined) return

    const outcome = this.recordEnding({ entry }).then((ending) =>
      ending === undefined
        ? { died: false as const }
        : {
            died: true as const,
            snapshot: entry.shell.snapshot(),
            delta: adopt === undefined ? ending : consumeEndingDelta(entry, ending),
          },
    )
    const tracked: Promise<void> = outcome.then(() => undefined)
    this.settling.add(tracked)
    void tracked.finally(() => void this.settling.delete(tracked))

    if (adopt !== undefined) {
      this.pendingKills.delete(entry.shell.shellId)
      adopt(outcome)
      return
    }
    this.endings.set(entry.shell.shellId, outcome)
  }

  private captureOutput(shellId: ShellId): void {
    const entry = this.tracked.get(shellId)
    if (entry === undefined || entry.endingRead !== undefined) return
    captureEnding(entry)
  }

  private async recordEnding(args: { entry: Tracked }): Promise<ShellDelta | undefined> {
    const delta = args.entry.endingEventDelta ?? captureEnding(args.entry)
    const snapshot = args.entry.shell.snapshot()

    const hooked = await afterShellDrafts({
      hooks: this.hooks,
      threadId: args.entry.threadId,
      shell: snapshot,
    })

    if (this.tracked.get(args.entry.shell.shellId) !== args.entry) return undefined

    if (this.log !== undefined && this.ids !== undefined) {
      const persisted = await this.log
        .append({
          threadId: args.entry.threadId,
          runId: this.ids.nextRunId(),
          drafts: [endedDraft({ snapshot, delta }), ...hooked],
        })
        .then(
          () => true,
          (cause: unknown) => {
            this.operations?.warn({
              source: 'shells.ending',
              threadId: args.entry.threadId,
              message: 'could not record a background shell ending',
              error: cause instanceof Error ? cause.message : String(cause),
              ...(cause instanceof Error && cause.stack !== undefined
                ? { stack: cause.stack }
                : {}),
            })
            return false
          },
        )
      if (!persisted) return delta
    }
    if (this.tracked.get(args.entry.shell.shellId) !== args.entry) return delta
    this.notices.queue({
      kind: ENotice.Ended,
      snapshot,
      threadId: args.entry.threadId,
    })
    return delta
  }

  private announceAwaitingInput(shell: BackgroundShell): void {
    const entry = this.tracked.get(shell.shellId)
    if (entry === undefined || entry.announced) return

    this.bump()
    this.notices.queue({
      kind: ENotice.AwaitingInput,
      snapshot: shell.snapshot(),
      take: () => previewDelta(entry),
      threadId: entry.threadId,
    })
  }

  private announceStillRunning(args: { shell: BackgroundShell; checkInMs: number }): void {
    const entry = this.tracked.get(args.shell.shellId)
    if (entry === undefined || entry.announced) return

    const snapshot = args.shell.snapshot()
    const now = Date.parse(this.clock.now())

    this.notices.queue({
      kind: ENotice.StillRunning,
      snapshot,
      threadId: entry.threadId,
      peek: () => args.shell.tail(CHECK_IN_TAIL_CHARACTERS),
      runningForMs: Math.max(now - Date.parse(snapshot.startedAt), 0),
      silentForMs: Math.max(now - Date.parse(snapshot.lastOutputAt), 0),
      checkInMs: args.checkInMs,
    })
  }

  /**
   * A match is queued with the lines already in hand rather than a cursor read, so what the model
   * is shown as matching is never subtracted from what shell_output would hand it next.
   */
  private announceMatched({
    shell,
    matched,
  }: {
    shell: BackgroundShell
    matched: MatchedLines
  }): void {
    const entry = this.tracked.get(shell.shellId)
    if (entry === undefined || entry.pattern === undefined) return

    this.notices.queue({
      kind: ENotice.Matched,
      snapshot: shell.snapshot(),
      threadId: entry.threadId,
      pattern: entry.pattern,
      matched,
    })
  }
}
