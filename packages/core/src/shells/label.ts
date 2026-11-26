import { oneLine } from '../text/one-line'

const QUOTED_COMMAND_CHARACTERS = 120

const ELLIPSIS = '…'

type NamedShell = { command: string; description?: string | undefined }

const trimmedDescription = (shell: NamedShell): string => shell.description?.trim() ?? ''

export function quotedShellCommand(command: string): string {
  const single = oneLine(command)
  const shown =
    single.length <= QUOTED_COMMAND_CHARACTERS
      ? single
      : `${single.slice(0, QUOTED_COMMAND_CHARACTERS)}${ELLIPSIS}`
  return `\`${shown}\``
}

export function shellName(shell: NamedShell): string {
  const named = trimmedDescription(shell)
  return named === '' ? oneLine(shell.command) : named
}

export function quotedShellName(shell: NamedShell): string {
  const named = trimmedDescription(shell)
  return named === '' ? quotedShellCommand(shell.command) : `"${named}"`
}

export function shellLabel(shell: NamedShell): string {
  const quoted = quotedShellCommand(shell.command)
  const named = trimmedDescription(shell)
  return named === '' ? quoted : `"${named}" (${quoted})`
}
