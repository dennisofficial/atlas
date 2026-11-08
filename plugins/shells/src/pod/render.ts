import { EShellStatus, shellEnding, shellLabel } from '@dltech/atlas-core'

import type { ShellDelta } from './cursors'
import { outcomeOf } from './status'

const stillRunning = (delta: ShellDelta): boolean =>
  outcomeOf(delta.info).status === EShellStatus.Running

const endingOf = (delta: ShellDelta): string =>
  shellEnding({ ...outcomeOf(delta.info), totalCharacters: delta.info.totalBytes })

const droppedNote = (dropped: number): string =>
  `[${dropped} characters were lost before this point: the shell printed faster than it was read.]`

const remainingNote = (remaining: number): string =>
  `[${remaining} more characters are waiting — call shell_output again for the rest.]`

export const renderOutput = (args: {
  shellId: string
  delta: ShellDelta
  awaiting: boolean
}): string => {
  const { delta } = args
  const running = stillRunning(delta)
  const sections = [
    running
      ? `Shell ${args.shellId} is still running.`
      : `Shell ${args.shellId} ${endingOf(delta)}.`,
  ]
  if (!running) {
    sections.push(
      '[This process is no longer running. Any output below is its final, complete output — not a snapshot of a live job. Do not wait for it, poll it, or expect more from it.]',
    )
  }
  if (args.awaiting) {
    sections.push(
      'It is sitting at a prompt waiting for input — this is a live, answerable state, NOT a closed or dead stdin. Answer it with shell_input (include a trailing newline). Do NOT kill and restart it just because it is waiting.',
    )
  }
  if (delta.droppedCharacters > 0) sections.push(droppedNote(delta.droppedCharacters))
  if (delta.text === '') {
    sections.push(
      running ? 'It has printed nothing new since the last read.' : 'It printed nothing more.',
    )
  } else {
    sections.push(delta.text.trimEnd())
  }
  if (delta.remainingCharacters > 0) sections.push(remainingNote(delta.remainingCharacters))
  return sections.join('\n\n')
}

export const renderKill = (args: { shellId: string; delta: ShellDelta }): string => {
  const { delta } = args
  if (outcomeOf(delta.info).status === EShellStatus.Exited) {
    return `Shell ${args.shellId} had already finished, so nothing was signalled.`
  }
  const exit = delta.info.exitCode === null ? '' : `, exit code ${delta.info.exitCode}`
  const sections = [
    `Killed shell ${args.shellId} and its process group${exit}. Everything it printed follows.`,
  ]
  if (delta.droppedCharacters > 0) sections.push(droppedNote(delta.droppedCharacters))
  sections.push(delta.text.trimEnd() === '' ? 'It printed nothing.' : delta.text.trimEnd())
  if (delta.remainingCharacters > 0) {
    sections.push(
      `[${delta.remainingCharacters} more characters are waiting — call shell_output({ shellId: "${args.shellId}" }) for the rest.]`,
    )
  }
  return sections.join('\n\n')
}

export const renderStarted = (args: { shellId: string }): string =>
  [
    `Started in the background as shell ${args.shellId}, and it outlives this turn.`,
    'Stopping a turn stops the turn, not the shell, so nothing here needed nohup, setsid or a detached subprocess.',
    'Its ending will arrive on its own with its output, even after this turn ends.',
    'So do not wait on it: no sleeping, no polling, no idle loop - a tick only spins the turn. Take up other work, or end the turn and be woken.',
    `Use shell_output({ shellId: "${args.shellId}" }) for unread output, shell_input to answer a prompt, and shell_kill to stop it.`,
  ].join(' ')

export const renderListLine = (args: {
  shellId: string
  command: string
  description?: string | undefined
  state: string
  characters: number
}): string =>
  `${args.shellId}  ${shellLabel(args)}  ${args.state}  (${args.characters} characters printed)`
