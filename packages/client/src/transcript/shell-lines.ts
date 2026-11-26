import { quotedShellName, type EventOfType } from '@dltech/atlas-core'

import { formatElapsed } from './format-elapsed'

const matchedLineCount = (count: number): string => (count === 1 ? '1 line' : `${count} lines`)

export const shellMatchedLine = (event: EventOfType<'background-shell-matched'>): string => {
  const named = quotedShellName(event)
  const matched = `matched ${matchedLineCount(event.matchCount)}`
  return event.watchDisarmed === true
    ? `Background shell ${named} ${matched}, but stopped watching`
    : `Background shell ${named} ${matched}`
}

export const shellStillRunningEntryLine = (
  event: EventOfType<'background-shell-still-running'>,
): string =>
  `Background shell ${quotedShellName(event)} is still running after ${formatElapsed(event.runningForMs)} - a scheduled check-in, not an ending`
