import {
  EKilledBy,
  EShellStatus,
  type ClockPort,
  type PortExposure,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { createOutputBuffer, type OutputDelta } from './output-buffer'
import { looksLikePrompt } from './prompt-sniff'
import type { ShellId } from './shell-id'
import {
  drainInto,
  messageOf,
  startShell,
  terminatorFor,
  withinReadGrace,
  type Drain,
  type Shell,
} from './shell-process'
import { createLineMatcher, type MatchedLines } from './shell-watch'

export { EKilledBy, EShellStatus }

const SNIFFED_TAIL_CHARACTERS = 240

export type ShellSnapshot = {
  shellId: ShellId
  /** The thread that started the shell, so a cross-thread listing can attribute each entry to its owner. */
  threadId: ThreadId
  /** The harness process that owns the shell, so its start and end pair against the right boot. */
  bootId?: string | undefined
  command: string
  description: string
  status: EShellStatus
  killedBy?: EKilledBy | undefined
  pid?: number | undefined
  exitCode?: number | undefined
  startedAt: string
  lastOutputAt: string
  endedAt?: string | undefined
  totalCharacters: number
  awaitingInput: boolean
  exposure?: PortExposure | undefined
}

export type BackgroundShell = {
  readonly shellId: ShellId
  snapshot(): ShellSnapshot
  since(offset: number): OutputDelta
  tail(limit: number): string
  kill(by: EKilledBy): void
  release(): void
  exited: Promise<void>
}

export type StartedBackgroundShell =
  | { ok: true; shell: BackgroundShell }
  | { ok: false; reason: string }

export type StartShellArgs = {
  threadId: ThreadId
  command: string
  description: string
  cwd?: string | undefined
  watch?: string | undefined
  timeoutMs?: number | undefined
  exposure?: PortExposure | undefined
}

export type StartedShellOutcome = { ok: true; snapshot: ShellSnapshot } | { ok: false; reason: string }

export type ShellDelta = {
  text: string
  droppedCharacters: number
  remainingCharacters: number
}

/**
 * The settled continuation a kill is handed back. The ending event is written into the durable log
 * at occurrence regardless of who signalled; `settled` is a read of that death for a caller that
 * cannot not return an answer, not the delivery of it. `died: false` means the process outlived
 * the settle deadline, in which case the ending lands when it lands, the same as any other.
 */
export type SettledShellOutcome =
  | { died: true; snapshot: ShellSnapshot; delta: ShellDelta }
  | { died: false }

export type ShellKillOutcome =
  | { ok: true; snapshot: ShellSnapshot; settled?: Promise<SettledShellOutcome> | undefined }
  | { ok: false; reason: string }

export type BackgroundShellSpec = {
  shellId: ShellId
  bootId: string
  command: string
  description: string
  cwd: string
  threadId: ThreadId
  clock: ClockPort
  retainCharacters: number
  overflowCharacters: number
  promptSettleMs: number
  watch?: RegExp | undefined
  matchSettleMs: number
  matchedLinesCap: number
  timeoutMs?: number | undefined
  silenceMs?: number | undefined
  exposure?: PortExposure | undefined
  processes?: ProcessPort | undefined
  onExit: (shell: BackgroundShell) => void
  /**
   * Fires inside the settle continuation, before the snapshot reports the shell ended: the
   * registry captures the remaining output there, so no observer can see a settled shell whose
   * buffer is still mid-read. Runs synchronously with the status flip. Receives the shell's id
   * rather than the shell — the shell object does not exist yet when the settle continuation is
   * first entered.
   */
  onSettled?: ((shellId: ShellId) => void) | undefined
  onAwaitingInput: (shell: BackgroundShell) => void
  onMatched: (args: { shell: BackgroundShell; matched: MatchedLines }) => void
  onActivity?: (() => void) | undefined
}

function stopReading(drains: readonly Drain[]): void {
  for (const drain of drains) drain.stop()
}

async function awaitOutputThrough(args: { shell: Shell; drains: readonly Drain[] }): Promise<number> {
  const exitCode = await args.shell.exited
  await withinReadGrace(Promise.all(args.drains.map((drain) => drain.done)))
  stopReading(args.drains)
  return exitCode
}

export function startBackgroundShell(spec: BackgroundShellSpec): StartedBackgroundShell {
  const started = startShell({
    command: spec.command,
    cwd: spec.cwd,
    processes: spec.processes,
    threadId: spec.threadId,
  })
  if (!started.ok) return started

  const { shell } = started
  const buffer = createOutputBuffer({ retain: spec.retainCharacters })
  const terminate = terminatorFor(shell)
  const startedAt = spec.clock.now()

  let status = EShellStatus.Running
  let killedBy: EKilledBy | undefined
  let lastOutputAt = startedAt
  let exitCode: number | undefined
  let endedAt: string | undefined
  let awaitingSettled = false
  let awaitingAnnounced = false
  let promptWatch: ReturnType<typeof setTimeout> | undefined
  let matchWatch: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let silence: ReturnType<typeof setTimeout> | undefined

  const drains: Drain[] = []

  const matcher =
    spec.watch === undefined
      ? undefined
      : createLineMatcher({ pattern: spec.watch, cap: spec.matchedLinesCap })

  const forgetPromptWatch = (): void => {
    if (promptWatch !== undefined) clearTimeout(promptWatch)
    promptWatch = undefined
  }

  const forgetMatchWatch = (): void => {
    if (matchWatch !== undefined) clearTimeout(matchWatch)
    matchWatch = undefined
  }

  const forgetDeadline = (): void => {
    if (deadline !== undefined) clearTimeout(deadline)
    deadline = undefined
  }

  const forgetSilence = (): void => {
    if (silence !== undefined) clearTimeout(silence)
    silence = undefined
  }

  const atAPrompt = (): boolean =>
    status === EShellStatus.Running && looksLikePrompt(buffer.tail(SNIFFED_TAIL_CHARACTERS))

  /**
   * The sniff fires on output that has no trailing newline, which every chunk arriving mid-line
   * satisfies for as long as it takes the rest of the line to show up. Only a tail that stays put
   * is a prompt, so the claim is made after the shell has been quiet, never on the chunk itself.
   */
  const settlePrompt = (): void => {
    promptWatch = undefined
    if (!atAPrompt()) return

    awaitingSettled = true
    if (awaitingAnnounced) return

    awaitingAnnounced = true
    try {
      spec.onAwaitingInput(self)
    } catch {
      return
    }
  }

  const watchForPrompt = (): void => {
    forgetPromptWatch()
    if (!atAPrompt()) return

    promptWatch = setTimeout(settlePrompt, spec.promptSettleMs)
    promptWatch.unref?.()
  }

  const kill = (by: EKilledBy): void => {
    if (status !== EShellStatus.Running) return
    status = EShellStatus.Killed
    killedBy = by
    forgetPromptWatch()
    forgetSilence()
    terminate()
  }

  if (spec.timeoutMs !== undefined) {
    deadline = setTimeout(() => kill(EKilledBy.Timeout), spec.timeoutMs)
    deadline.unref?.()
  }

  /**
   * A background shell exists to be waited on, and a waiter that goes silent may be stuck on
   * something that never ends — gh run watch does not exit when GitHub cancels the run. A shell
   * that prints nothing for the ceiling is killed as a timeout, and that ending wakes the owner
   * like any other, so a wait can never sit indefinitely. Output re-arms the clock: an active
   * shell is never touched.
   */
  const armSilence = (): void => {
    forgetSilence()
    if (spec.silenceMs === undefined) return
    silence = setTimeout(() => kill(EKilledBy.Timeout), spec.silenceMs)
    silence.unref?.()
  }

  armSilence()

  const deliverMatches = (): void => {
    matchWatch = undefined
    if (matcher === undefined || !matcher.pending()) return

    const matched = matcher.take()
    try {
      spec.onMatched({ shell: self, matched })
    } catch {
      return
    }
  }

  /**
   * The window opens on the first match and is not reset by the ones behind it, so a shell that
   * matches every line it prints still reports on a cadence rather than never.
   */
  const watchForMatches = (chunk: string): void => {
    if (matcher === undefined) return

    matcher.append(chunk)
    if (!matcher.pending() || matchWatch !== undefined) return

    matchWatch = setTimeout(deliverMatches, spec.matchSettleMs)
    matchWatch.unref?.()
  }

  const overflow = (): void => {
    if (status !== EShellStatus.Running) return
    status = EShellStatus.Overflowed
    forgetPromptWatch()
    terminate()
    stopReading(drains)
  }

  const append = (chunk: string): void => {
    if (chunk === '') return
    buffer.append(chunk)
    spec.onActivity?.()
    lastOutputAt = spec.clock.now()
    awaitingSettled = false
    armSilence()
    watchForMatches(chunk)
    if (buffer.totalCharacters() > spec.overflowCharacters) return overflow()

    watchForPrompt()
  }

  drains.push(
    drainInto({ stream: shell.stdout, append }),
    drainInto({ stream: shell.stderr, append }),
  )

  const settled = (async () => {
    try {
      exitCode = await awaitOutputThrough({ shell, drains })
    } catch (error) {
      append(
        `\natlas could not read this shell to the end: ${messageOf(error)} — the process was killed rather than left running untracked; if the kill could not be delivered, it may still be running\n`,
      )
      kill(EKilledBy.LostContact)
    } finally {
      endedAt = spec.clock.now()
      forgetPromptWatch()
      forgetDeadline()
      forgetSilence()
      awaitingSettled = false
      if (status === EShellStatus.Running) status = EShellStatus.Exited
      // The capture fires synchronously with the flip: a snapshot that says the shell ended has
      // its output claimed already, so a read never races the settle and finds nothing. The
      // callback must run after the assignment — the capture freezes a snapshot of its own.
      try {
        spec.onSettled?.(spec.shellId)
      } catch {
        // A throwing capture must not strand the shell's ending unannounced.
      }
      forgetMatchWatch()
    }
  })()

  const self: BackgroundShell = {
    shellId: spec.shellId,

    snapshot: () => ({
      shellId: spec.shellId,
      threadId: spec.threadId,
      bootId: spec.bootId,
      command: spec.command,
      description: spec.description,
      status,
      killedBy,
      pid: shell.pid,
      exitCode,
      startedAt,
      lastOutputAt,
      endedAt,
      totalCharacters: buffer.totalCharacters(),
      awaitingInput: status === EShellStatus.Running && awaitingSettled,
      exposure: spec.exposure,
    }),

    since: (offset) => buffer.since(offset),
    tail: (limit) => buffer.tail(limit),
    kill,
    release: () => buffer.release(),

    exited: settled.then(() => {
      try {
        spec.onExit(self)
      } catch {
        return
      }
    }),
  }

  return { ok: true, shell: self }
}
