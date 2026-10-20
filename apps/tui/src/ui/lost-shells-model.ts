import type { LostShell } from '@dltech/atlas-harness'

export const hasLostShells = (lostShells: readonly LostShell[]): boolean => lostShells.length > 0

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const shellName = (shell: LostShell): string => {
  const described = shell.description === undefined ? '' : oneLine(shell.description)
  return described === '' ? oneLine(shell.command) : described
}

export const lostShellCount = (lostShells: readonly LostShell[]): string =>
  lostShells.length === 1 ? '1 background shell' : `${lostShells.length} background shells`

/**
 * The synthetic ending the reconciler wrote is on the transcript already; this notice is the tap on
 * the shoulder, so the operator looks before carrying on in a workspace a dying shell may have
 * changed mid-command.
 */
export const lostShellsNotice = (lostShells: readonly LostShell[]): string =>
  `${lostShellCount(lostShells)} died with the last process — ended without a record: ${lostShells.map(shellName).join(', ')}`
