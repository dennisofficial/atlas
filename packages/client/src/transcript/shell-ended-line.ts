import { EKilledBy, EShellStatus, quotedShellName } from '@dltech/atlas-core'

export type ShellEnding = {
  command: string
  description?: string | undefined
  status: EShellStatus
  killedBy?: EKilledBy | undefined
  exitCode?: number | undefined
}

type NamedShell = { command: string; description?: string | undefined }

const killedOutcome = (killedBy: EKilledBy | undefined): string => {
  if (killedBy === EKilledBy.User) return 'was killed by you'
  if (killedBy === EKilledBy.Model) return 'was killed by atlas'
  if (killedBy === EKilledBy.SessionEnd) return 'was killed when the sandbox went to sleep'
  if (killedBy === EKilledBy.Timeout) return 'ran past its timeout'
  if (killedBy === EKilledBy.Rewind) return 'was killed by a rewind'
  if (killedBy === EKilledBy.LostContact) return 'was killed after atlas lost contact with it'
  if (killedBy === EKilledBy.Unrecorded) return 'was killed when the previous session ended'
  if (killedBy === EKilledBy.OutOfMemory) return 'ran out of memory'
  return 'was killed'
}

function outcomeOf(ending: ShellEnding): string {
  if (ending.status === EShellStatus.Killed) return killedOutcome(ending.killedBy)
  if (ending.status === EShellStatus.Overflowed) return 'was killed for printing too much'
  if (ending.exitCode === undefined) return 'ended'
  if (ending.exitCode === 0) return 'completed (exit code 0)'
  return `failed (exit code ${ending.exitCode})`
}

export const shellEndedLine = (ending: ShellEnding): string =>
  `Background shell ${quotedShellName(ending)} ${outcomeOf(ending)}`

export const shellEndingFailed = (ending: ShellEnding): boolean =>
  ending.status === EShellStatus.Overflowed ||
  ending.killedBy === EKilledBy.OutOfMemory ||
  ending.killedBy === EKilledBy.Timeout ||
  ending.killedBy === EKilledBy.LostContact ||
  (ending.exitCode !== undefined && ending.exitCode !== 0)

export const shellAwaitingInputLine = (shell: NamedShell): string =>
  `Background shell ${quotedShellName(shell)} reached an input prompt`

export const shellMatchedNoticeLine = (shell: NamedShell): string =>
  `Background shell ${quotedShellName(shell)} matched its watch`
