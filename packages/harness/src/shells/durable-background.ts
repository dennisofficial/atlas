import type { ClockPort, PortExposure, ThreadId } from '@dltech/atlas-core'
import { EKilledBy, EShellStatus } from '@dltech/atlas-core'

import type { BackgroundShell, ShellInputOutcome, ShellSnapshot } from './background-shell'
import {
  completeUtf8Length,
  SCAN_BYTES,
  saveCursor,
  tailOf,
  windowOf,
  type ShellCursor,
} from './output-preview'
import type { ShellAttachment, ShellExit } from './port'
import { looksLikePrompt } from './prompt-sniff'
import type { ShellId } from './shell-id'
import { createLineMatcher, type MatchedLines } from './shell-watch'

const SNIFFED_BYTES = 240
const NEWLINE = 10

export type OpenShellSpec = {
  attachment: ShellAttachment
  threadId: ThreadId
  bootId?: string | undefined
  command: string
  description: string
  clock: ClockPort
  cursor: ShellCursor
  watch?: RegExp | undefined
  exposure?: PortExposure | undefined
  promptSettleMs: number
  matchSettleMs: number
  matchedLinesCap: number
  finished?: ShellExit | undefined
  onExit: (shell: BackgroundShell) => void
  onAwaitingInput: (shell: BackgroundShell) => void
  onMatched: (args: { shell: BackgroundShell; matched: MatchedLines }) => void
  onActivity: () => void
}

const unref = (timer: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> => {
  timer.unref?.()
  return timer
}

export function openBackgroundShell(spec: OpenShellSpec): BackgroundShell {
  const { attachment } = spec
  const shellId: ShellId = attachment.shellId
  const cursor: ShellCursor = { ...spec.cursor }
  const decoder = new TextDecoder()
  const matcher =
    spec.watch === undefined
      ? undefined
      : createLineMatcher({ pattern: spec.watch, cap: spec.matchedLinesCap })

  let status = EShellStatus.Running
  let killedBy: EKilledBy | undefined
  let exitCode: number | undefined
  let endedAt: string | undefined
  let total = attachment.totalBytes()
  let lastOutputAt = spec.clock.now()
  let awaitingSettled = false
  let detached = false
  let scanned = cursor.watched
  let lineStart = cursor.watched
  let scanning: Promise<void> = Promise.resolve()
  let persisting: Promise<void> = Promise.resolve()
  let promptWatch: ReturnType<typeof setTimeout> | undefined
  let matchWatch: ReturnType<typeof setTimeout> | undefined
  let announceExit: (exit: ShellExit) => void = () => undefined
  const exitArrived = new Promise<ShellExit>((resolve) => {
    announceExit = resolve
  })

  const persist = (): void => {
    persisting = persisting
      .then(() => saveCursor({ path: attachment.cursorPath, cursor: { ...cursor } }))
      .catch(() => undefined)
  }

  const forgetTimers = (): void => {
    if (promptWatch !== undefined) clearTimeout(promptWatch)
    if (matchWatch !== undefined) clearTimeout(matchWatch)
    promptWatch = undefined
    matchWatch = undefined
  }

  const deliverMatches = (): void => {
    matchWatch = undefined
    if (matcher === undefined || !matcher.pending() || detached) return
    const matched = matcher.take()
    cursor.watched = lineStart
    persist()
    try {
      spec.onMatched({ shell: self, matched })
    } catch {
      return
    }
  }

  const scan = async (final: boolean): Promise<void> => {
    if (matcher === undefined) return
    for (;;) {
      const available = attachment.totalBytes()
      if (scanned >= available) break
      const bytes = await attachment.readOutput({
        start: scanned,
        limit: Math.min(SCAN_BYTES, available - scanned),
      })
      const reachesEnd = scanned + bytes.length >= available
      const whole = final && reachesEnd ? bytes.length : completeUtf8Length(bytes)
      if (whole === 0) break
      const chunk = bytes.subarray(0, whole)
      matcher.append(decoder.decode(chunk))
      const newline = chunk.lastIndexOf(NEWLINE)
      if (newline >= 0) lineStart = scanned + newline + 1
      scanned += whole
    }
    if (final) return
    if (matcher.pending()) {
      matchWatch ??= unref(setTimeout(deliverMatches, spec.matchSettleMs))
      return
    }
    if (cursor.watched === lineStart) return
    cursor.watched = lineStart
    persist()
  }

  const scheduleScan = (): void => {
    scanning = scanning.then(() => scan(false)).catch(() => undefined)
  }

  const settlePrompt = async (): Promise<void> => {
    promptWatch = undefined
    if (status !== EShellStatus.Running || detached) return
    const at = attachment.totalBytes()
    const text = await tailOf({ attachment, limit: SNIFFED_BYTES, finished: false }).catch(() => '')
    if (status !== EShellStatus.Running || detached || attachment.totalBytes() !== at) return
    if (!looksLikePrompt(text)) return

    awaitingSettled = true
    if (cursor.prompted === at) return
    cursor.prompted = at
    persist()
    try {
      spec.onAwaitingInput(self)
    } catch {
      return
    }
  }

  const watchForPrompt = (): void => {
    if (promptWatch !== undefined) clearTimeout(promptWatch)
    promptWatch = unref(setTimeout(() => void settlePrompt(), spec.promptSettleMs))
  }

  const handleOutput = (bytes: number): void => {
    if (detached) return
    total = Math.max(total, bytes)
    lastOutputAt = spec.clock.now()
    awaitingSettled = false
    spec.onActivity()
    scheduleScan()
    if (status === EShellStatus.Running) watchForPrompt()
  }

  const settle = async (): Promise<void> => {
    const exit = await exitArrived
    await scanning
    await scan(true).catch(() => undefined)
    forgetTimers()
    if (detached) return
    awaitingSettled = false
    total = Math.max(total, exit.totalBytes)
    endedAt = exit.endedAt ?? spec.clock.now()
    exitCode = exit.exitCode
    if (exit.status === EShellStatus.Exited) {
      status = EShellStatus.Exited
      killedBy = undefined
    } else {
      killedBy = killedBy ?? exit.killedBy ?? EKilledBy.Unrecorded
      status = exit.status
    }
    try {
      spec.onExit(self)
    } catch {
      return
    }
  }
  let finishExited: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    finishExited = resolve
  })

  const self: BackgroundShell = {
    shellId,
    exited,
    attachment,

    snapshot: (): ShellSnapshot => ({
      shellId,
      threadId: spec.threadId,
      bootId: spec.bootId,
      command: spec.command,
      description: spec.description,
      status,
      killedBy,
      pid: attachment.pid,
      exitCode,
      startedAt: attachment.startedAt,
      lastOutputAt,
      endedAt,
      totalCharacters: total,
      awaitingInput: status === EShellStatus.Running && awaitingSettled,
      exposure: spec.exposure,
      outputPath: attachment.outputPath,
      inputSupported: attachment.inputSupported,
    }),

    preview: (limit) =>
      windowOf({
        attachment,
        from: cursor.read,
        limit,
        finished: status !== EShellStatus.Running,
      }),

    consume: async (limit) => {
      const window = await windowOf({
        attachment,
        from: cursor.read,
        limit,
        finished: status !== EShellStatus.Running,
      })
      if (window.outputEnd > cursor.read) {
        cursor.read = window.outputEnd
        persist()
      }
      return window
    },

    acknowledge: (to) => {
      if (to <= cursor.read) return
      cursor.read = to
      persist()
    },

    tail: (limit) =>
      tailOf({ attachment, limit, finished: status !== EShellStatus.Running }),

    writeInput: async (args): Promise<ShellInputOutcome> => {
      if (status !== EShellStatus.Running) {
        return { ok: false, reason: `shell ${shellId} is no longer running, so it cannot take input` }
      }
      const written = await attachment.writeInput(args)
      if (written.ok) awaitingSettled = false
      return written
    },

    kill: (by) => {
      if (status !== EShellStatus.Running) return
      status = EShellStatus.Killed
      killedBy = by
      awaitingSettled = false
      if (promptWatch !== undefined) clearTimeout(promptWatch)
      promptWatch = undefined
      attachment.kill(by)
    },

    detach: async () => {
      detached = true
      forgetTimers()
      await scanning
      persist()
      await persisting
      await attachment.detach()
    },
  }

  void settle().finally(finishExited)
  attachment.watch({ onOutput: handleOutput, onExit: announceExit })
  if (spec.finished !== undefined) announceExit(spec.finished)
  else if (total > 0 || cursor.prompted !== undefined) {
    scheduleScan()
    watchForPrompt()
  }

  return self
}
