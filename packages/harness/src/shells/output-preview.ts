import { EShellStatus, type ThreadId } from '@dltech/atlas-core'

import type { BackgroundShell, ShellDelta, ShellSnapshot } from './background-shell'
import type { OutputDelta } from './output-buffer'

export const DELIVERED_CHARACTERS = 30_000

export type Tracked = {
  shell: BackgroundShell
  cursor: number
  announced: boolean
  endingClaimed: boolean
  reaped: boolean
  threadId: ThreadId
  pattern?: string | undefined
  onReaped?: (() => void) | undefined
}

export type OutputPreview = {
  delta: ShellDelta
  commit: () => void
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
 * The cursor is the model's place in a shell, so taking a delta is what marks output as delivered.
 */
export function take(entry: Tracked): ShellDelta {
  const measured = measure(entry)
  commit(entry, measured)
  return measured.delta
}

/**
 * A preview reads without advancing: the delta is handed over at prepare time, while the cursor and
 * the release of the shell's retained output wait for the batch to be acknowledged. The commit
 * climbs rather than assigns — a read or a later print that moved the cursor meanwhile is never
 * rewound — and releases only when the cursor has reached everything the shell holds now, so bytes
 * that arrived after the preview are never freed unread.
 */
export function previewOutput(entry: Tracked): OutputPreview {
  const measured = measure(entry)
  return {
    delta: measured.delta,
    commit: () => commit(entry, measured),
  }
}
