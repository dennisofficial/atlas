import { quotedShellCommand, type EventOfType } from '@dltech/atlas-core'

import { formatElapsed } from './format-elapsed'

export const shellName = (shell: { command: string; description?: string | undefined }): string => {
  const description = shell.description?.trim() ?? ''
  return description === '' ? quotedShellCommand(shell.command) : `"${description}"`
}

const matchedLineCount = (count: number): string => (count === 1 ? '1 line' : `${count} lines`)

export const shellMatchedLine = (event: EventOfType<'background-shell-matched'>): string => {
  const named = shellName(event)
  const matched = `matched ${matchedLineCount(event.matchCount)}`
  return event.watchDisarmed === true
    ? `Background shell ${named} ${matched}, but stopped watching`
    : `Background shell ${named} ${matched}`
}

export const shellStillRunningEntryLine = (
  event: EventOfType<'background-shell-still-running'>,
): string =>
  `Background shell ${shellName(event)} is still running after ${formatElapsed(event.runningForMs)} - a scheduled check-in, not an ending`
