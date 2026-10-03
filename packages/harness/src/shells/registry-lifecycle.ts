import { EKilledBy, EShellStatus, type ClockPort, type PortExposure, type ThreadId } from '@dltech/atlas-core'

import type { SleepPrevention } from '../power/sleep-prevention'
import { bootId } from './boot'
import type {
  BackgroundShell,
  SettledShellOutcome,
  ShellKillOutcome,
  StartedShellOutcome,
  StartShellArgs,
} from './background-shell'
import { openBackgroundShell } from './durable-background'
import { saveCursor, type ShellCursor } from './output-preview'
import type { ShellAttachment, ShellExit, ShellLauncherPort } from './port'
import {
  KILL_SETTLE_MS,
  PROMPT_SETTLE_MS,
  RegistryState,
  withinDeadline,
  type Tracked,
} from './registry-entries'
import { ShellEvents } from './registry-events'
import { abandonShell } from './registry-teardown'
import { compileWatch, MATCH_SETTLE_MS, MATCHED_LINES_CAP } from './shell-watch'

export type LifecycleDeps = {
  state: RegistryState
  events: ShellEvents
  clock: ClockPort
  root: string
  silenceMs: number
  launcher?: ShellLauncherPort | undefined
  sleepPrevention?: SleepPrevention | undefined
}

export type OpenSpec = {
  attachment: ShellAttachment
  threadId: ThreadId
  bootId?: string | undefined
  command: string
  description: string
  cursor: ShellCursor
  exposure?: PortExposure | undefined
  finished?: ShellExit | undefined
}

export const NO_LAUNCHER = 'no durable shell launcher is configured, so background shells cannot start'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class ShellLifecycle {
  constructor(private readonly deps: LifecycleDeps) {}

  start(args: StartShellArgs): Promise<StartedShellOutcome> {
    return this.deps.state.admitStart(() => this.startAdmitted(args))
  }

  private async startAdmitted(args: StartShellArgs): Promise<StartedShellOutcome> {
    const { launcher, state } = this.deps
    const watch = compileWatch(args.watch)
    if (!watch.ok) return watch
    if (launcher === undefined) return { ok: false, reason: NO_LAUNCHER }

    const launched = await Promise.resolve()
      .then(() => launcher.launch({
        threadId: args.threadId,
        command: args.command,
        description: args.description,
        cwd: args.cwd ?? this.deps.root,
        timeoutMs: args.timeoutMs,
        outputLimitBytes: args.outputLimitBytes,
        silenceMs: this.deps.silenceMs,
      }))
      .catch((error: unknown) => ({ ok: false as const, reason: messageOf(error) }))
    if (!launched.ok) return launched

    const cursor: ShellCursor = {
      read: 0,
      watched: 0,
      ...(args.watch === undefined ? {} : { pattern: args.watch }),
    }
    await saveCursor({ path: launched.attachment.cursorPath, cursor }).catch(() => undefined)
    const entry = this.open({
      attachment: launched.attachment,
      threadId: args.threadId,
      bootId,
      command: args.command,
      description: args.description,
      cursor,
      exposure: args.exposure,
    })

    const recorded = await state.journal?.started({
      threadId: args.threadId,
      shellId: entry.shell.shellId,
      snapshot: entry.shell.snapshot(),
    })
    if (recorded !== undefined && !recorded.appended) {
      await abandonShell({ state, entry })
      return {
        ok: false,
        reason: `could not record the start of shell ${entry.shell.shellId} in the thread's event log, so the shell was stopped`,
      }
    }
    return { ok: true, snapshot: entry.shell.snapshot() }
  }

  open(spec: OpenSpec): Tracked {
    const { state, events, clock, sleepPrevention } = this.deps
    const compiled = compileWatch(spec.cursor.pattern)
    const shell = openBackgroundShell({
      attachment: spec.attachment,
      threadId: spec.threadId,
      bootId: spec.bootId,
      command: spec.command,
      description: spec.description,
      clock,
      cursor: spec.cursor,
      watch: compiled.ok ? compiled.pattern : undefined,
      exposure: spec.exposure,
      promptSettleMs: PROMPT_SETTLE_MS,
      matchSettleMs: MATCH_SETTLE_MS,
      matchedLinesCap: MATCHED_LINES_CAP,
      finished: spec.finished,
      onExit: (exited) => this.announceExit(exited),
      onAwaitingInput: (prompted) => events.announceAwaitingInput(prompted),
      onMatched: (matched) => events.announceMatched(matched),
      onActivity: () => state.noteActivity(),
    })
    const entry: Tracked = {
      shell,
      threadId: spec.threadId,
      pattern: spec.cursor.pattern,
      announced: false,
      reaped: false,
    }
    state.tracked.set(shell.shellId, entry)
    if (spec.finished === undefined) {
      const release = sleepPrevention?.acquire()
      if (release !== undefined) state.releases.set(shell.shellId, release)
    }
    state.bump()
    return entry
  }

  kill(args: { entry: Tracked; by: EKilledBy }): ShellKillOutcome {
    const { entry, by } = args
    const wasRunning = entry.shell.snapshot().status === EShellStatus.Running
    entry.shell.kill(by)
    const snapshot = entry.shell.snapshot()
    if (by !== EKilledBy.Model) return { ok: true, snapshot }

    if (!wasRunning) {
      const inFlight = this.deps.state.endings.get(entry.shell.shellId)
      const dying =
        snapshot.status === EShellStatus.Killed || snapshot.status === EShellStatus.Overflowed
      return dying && inFlight !== undefined
        ? { ok: true, snapshot, settled: inFlight }
        : { ok: true, snapshot }
    }
    const settled = this.settledOf(entry)
    return settled === undefined ? { ok: true, snapshot } : { ok: true, snapshot, settled }
  }

  async awaitEndings(args: { threadId: ThreadId; ms: number }): Promise<number> {
    const { state } = this.deps
    const signalled = [...state.tracked.values()].filter(
      (entry) =>
        entry.threadId === args.threadId && entry.shell.snapshot().status !== EShellStatus.Running,
    )
    const deaths = await Promise.all(
      signalled.map((entry) =>
        withinDeadline({ promise: entry.shell.exited.catch(() => undefined), ms: args.ms }),
      ),
    )
    await withinDeadline({
      promise: Promise.all([...state.endingSettlements]).catch(() => undefined),
      ms: args.ms,
    })
    return deaths.filter((died) => !died).length
  }

  private settledOf(entry: Tracked): Promise<SettledShellOutcome> | undefined {
    const { state } = this.deps
    const id = entry.shell.shellId
    const existing = state.endings.get(id)
    if (existing !== undefined) return existing
    if (entry.shell.snapshot().status === EShellStatus.Running) return undefined
    if (state.tracked.get(id) !== entry) return undefined

    let adopt: ((outcome: Promise<SettledShellOutcome>) => void) | undefined
    const waiting = new Promise<SettledShellOutcome>((resolve) => {
      adopt = (outcome) => void outcome.then(resolve)
      void withinDeadline({ promise: entry.shell.exited, ms: KILL_SETTLE_MS }).then((died) => {
        if (died) return
        if (state.endings.get(id) === waiting) state.endings.delete(id)
        state.pendingKills.delete(id)
        resolve({ died: false })
      })
    })
    state.endings.set(id, waiting)
    state.pendingKills.set(id, (outcome) => adopt?.(outcome))
    return waiting
  }

  private announceExit(shell: BackgroundShell): void {
    const { state } = this.deps
    state.releaseAssertion(shell.shellId)
    const entry = state.tracked.get(shell.shellId)
    if (entry === undefined || entry.announced) return

    entry.announced = true
    state.bump()
    this.settle(entry)
  }

  private settle(entry: Tracked): void {
    const { state, events } = this.deps
    const id = entry.shell.shellId
    let adopt = state.pendingKills.get(id)
    if (adopt === undefined && state.endings.get(id) !== undefined) return
    if (adopt === undefined && entry.shell.snapshot().status === EShellStatus.Running) {
      adopt = () => undefined
    }

    const outcome = events.recordEnding(entry).then((recorded): SettledShellOutcome => {
      if (recorded === undefined) return { died: false }
      const snapshot = entry.shell.snapshot()
      if (!recorded.appended) {
        state.failedEndings.add(id)
        return { died: true, snapshot, delta: recorded.delta }
      }
      state.failedEndings.delete(id)
      if (adopt !== undefined) entry.shell.acknowledge(snapshot.totalCharacters)
      if (state.tracked.get(id) === entry) {
        entry.reaped = true
        state.noteReaped(id)
      }
      return { died: true, snapshot, delta: recorded.delta }
    })
    const tracked: Promise<void> = outcome.then(() => undefined)
    state.endingSettlements.add(tracked)
    void tracked.finally(() => {
      state.endingSettlements.delete(tracked)
      if (!state.settling()) state.announceSettled()
    })

    if (adopt !== undefined) {
      state.pendingKills.delete(id)
      adopt(outcome)
      return
    }
    state.endings.set(id, outcome)
  }
}
