import { EShellStatus, type ThreadId } from '@dltech/atlas-core'

import type { BackgroundShell, ShellDelta, ShellSnapshot } from './background-shell'
import type { OutputDelta } from './output-buffer'

export const DELIVERED_CHARACTERS = 30_000

export type Tracked = {
  shell: BackgroundShell
  cursor: number
  announced: boolean
  reaped: boolean
  threadId: ThreadId
  pattern?: string | undefined
  onReaped?: (() => void) | undefined
  /**
   * The full remaining output the occurrence capture read, still owed to the model's first read:
   * the buffer is released at occurrence, so without it a read after settle would report nothing
   * printed. Unlike the event's delta this is not capped at DELIVERED_CHARACTERS.
   */
  endingRead?: { text: string; droppedCharacters: number } | undefined
  /** The event-shaped (DELIVERED_CHARACTERS-capped) delta the occurrence append carried. */
  endingEventDelta?: ShellDelta | undefined
}

const releasedShell = ({ snapshot }: { snapshot: ShellSnapshot }): BackgroundShell => ({
  shellId: snapshot.shellId,
  snapshot: () => snapshot,
  since: (offset): OutputDelta => {
    const asked = Math.min(Math.max(Math.trunc(offset), 0), snapshot.totalCharacters)
    return {
      text: '',
      nextOffset: snapshot.totalCharacters,
      droppedCharacters: snapshot.totalCharacters - asked,
      totalCharacters: snapshot.totalCharacters,
    }
  },
  tail: () => '',
  kill: () => {},
  release: () => {},
  exited: Promise.resolve(),
})

const measure = (entry: Tracked): { delta: ShellDelta; nextCursor: number } => {
  const delta = entry.shell.since(entry.cursor)
  const text = delta.text.slice(0, DELIVERED_CHARACTERS)
  const nextCursor = entry.cursor + delta.droppedCharacters + text.length
  return {
    delta: {
      text,
      droppedCharacters: delta.droppedCharacters,
      remainingCharacters: Math.max(delta.totalCharacters - nextCursor, 0),
    },
    nextCursor,
  }
}

const commit = (entry: Tracked, preview: { nextCursor: number }): void => {
  entry.cursor = Math.max(entry.cursor, preview.nextCursor)

  const snapshot = entry.shell.snapshot()
  if (entry.cursor >= snapshot.totalCharacters && snapshot.status !== EShellStatus.Running) {
    entry.shell.release()
    entry.shell = releasedShell({ snapshot })
    entry.reaped = true
    entry.onReaped?.()
  }
}

/**
 * An ending hands over the shell's whole remaining output at occurrence: the capture marks
 * everything delivered and releases the buffer, so an ended shell's output dies with its ending
 * instead of waiting on a later drain. The capture does not consume the model's cursor — the
 * delta is kept on the entry (`endingDelta`) so the first shell_output after settle still reads
 * what the shell printed; a second read finds it consumed.
 */
export function take(entry: Tracked): ShellDelta {
  const measured = measure(entry)
  commit(entry, measured)
  return measured.delta
}

/**
 * The occurrence-time capture for an ending: reads the whole remaining output and releases the
 * buffer, without moving the model's cursor. The delta is kept on the entry (`endingDelta`) so
 * shell_output's first read after settle still hands over what the shell printed; the cursor only
 * advances when that read happens.
 */
export function captureEnding(entry: Tracked): ShellDelta {
  const full = entry.shell.since(entry.cursor)
  const measured = measure(entry)
  const snapshot = entry.shell.snapshot()
  entry.shell.release()
  entry.shell = releasedShell({ snapshot })
  entry.reaped = true
  entry.endingRead = { text: full.text, droppedCharacters: full.droppedCharacters }
  entry.endingEventDelta = measured.delta
  entry.onReaped?.()
  return measured.delta
}

/**
 * The first read after settle hands over the full output the occurrence capture read — uncapped,
 * because the event's cap is the log's concern, not the model's — and advances the cursor past the
 * whole shell. Anything later falls through to the released shell, which answers counts only.
 */
export function takeAfterEnding(entry: Tracked): ShellDelta {
  const captured = entry.endingRead
  if (captured === undefined) return take(entry)
  entry.endingRead = undefined
  const total = entry.shell.snapshot().totalCharacters
  entry.cursor = total
  return { text: captured.text, droppedCharacters: captured.droppedCharacters, remainingCharacters: 0 }
}

/**
 * The kill's settled continuation is the model's read of the death, so it consumes the captured
 * output the way a shell_output would — a read after it finds nothing more.
 */
export function consumeEndingDelta(entry: Tracked, delta: ShellDelta): ShellDelta {
  if (entry.endingRead !== undefined) {
    entry.endingRead = undefined
    entry.cursor = entry.shell.snapshot().totalCharacters
  }
  return delta
}

/**
 * A read or a live announcement hands over a delta without releasing: a running shell has output
 * still coming, so the buffer outlives the read. `take` is the ending-time form.
 */
export function previewDelta(entry: Tracked): ShellDelta {
  const measured = measure(entry)
  entry.cursor = Math.max(entry.cursor, measured.nextCursor)
  return measured.delta
}


