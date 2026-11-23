import { EShellStatus } from '@dltech/atlas-core'
import type { ShellRow } from '@dltech/atlas-plugin-shells/core'

export type DrawerShell = {
  shellId: string
  threadId: string
  command: string
  description: string
  status: EShellStatus
  exitCode?: number | undefined
  startedAt: string
  lastOutputAt: string
  totalCharacters: number
  awaitingInput: boolean
}

/**
 * The v2 shell view carries no thread and no start time, so the open session stands in for the
 * thread and `changedAt` dates both ends — the drawer only reads them for an elapsed time.
 */
export const drawerShellsOf = (args: {
  rows: readonly ShellRow[]
  sessionId: string
}): readonly DrawerShell[] =>
  args.rows.map((row) => ({
    shellId: row.shellId,
    threadId: args.sessionId,
    command: row.command,
    description: row.name,
    status: row.status,
    startedAt: row.changedAt,
    lastOutputAt: row.changedAt,
    totalCharacters: row.characters,
    awaitingInput: row.awaitingInput,
  }))

export const isDrawerShellRunning = (shell: DrawerShell): boolean =>
  shell.status === EShellStatus.Running

export const shellFoldOf = (
  rows: readonly DrawerShell[],
): { hidden: number; hiddenFailed: boolean } => {
  const settled = rows.filter((row) => !isDrawerShellRunning(row))
  return {
    hidden: settled.length,
    hiddenFailed: settled.some((row) => row.status !== EShellStatus.Exited),
  }
}

export const shellOutputOf = (args: {
  tails: Readonly<Record<string, { text: string }>>
  shellId: string
}): string => args.tails[args.shellId]?.text ?? ''
