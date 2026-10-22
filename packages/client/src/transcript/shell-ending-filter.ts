import { EKilledBy, type Event, type EventOfType } from '@dltech/atlas-core'

export type ShellEndingFilter = {
  isRedundantEnding: (event: EventOfType<'background-shell-ended'>) => boolean
  noteShellEnding: (event: EventOfType<'background-shell-ended'>) => void
  noteToolResult: (event: Event) => void
}

export function createShellEndingFilter(): ShellEndingFilter {
  /**
   * Teardown once re-recorded an ending for every shell a turn had already settled, appending a
   * second background-shell-ended behind the real one with killedBy session-end and empty output.
   * Those duplicate events sit in the log permanently, so the transcript drops a session-end ending
   * that follows a clean ending for the same shell and command — keyed on the command too, because
   * a shell id is reused across restarts and a fresh shell under it must still announce. Only a
   * session-end ending after a clean one is dropped: a shell_kill or a second clean exit is a
   * deliberate telling and stays, and a session-end ending that follows only another session-end
   * (a shell genuinely killed at close under a recycled id) stays too, because no clean ending
   * ever settled it.
   */
  const settledShells = new Set<string>()
  const isRedundantTeardownEnding = (event: EventOfType<'background-shell-ended'>): boolean => {
    if (event.killedBy !== EKilledBy.SessionEnd) return false
    const key = `${event.shellId}${event.command}`
    return settledShells.has(key)
  }
  const noteShellEnding = (event: EventOfType<'background-shell-ended'>): void => {
    if (event.killedBy === EKilledBy.SessionEnd) return
    settledShells.add(`${event.shellId}${event.command}`)
  }

  /**
   * The same teardown also re-recorded shells the model had already killed through shell_kill:
   * that ending was delivered as the tool result, so no standalone event was meant to exist, and
   * the synthesized one carries empty output. Those sit in old logs permanently, so the transcript
   * drops a model-kill ending with no output when a shell_kill tool result for the same shell and
   * command is already present. Keyed on the command too, because a shell id recycles across
   * restarts and an old kill must not hide a fresh shell's genuinely silent ending. An ending with
   * real output is always kept — output means it was the telling, never a synthesized dupe.
   */
  const shellKillResults = new Set<string>()
  const noteToolResult = (event: Event): void => {
    if (event.type !== 'tool-result' || event.name !== 'shell_kill') return
    const output = event.output
    if (typeof output !== 'object' || output === null) return
    const record = output as { shellId?: unknown; command?: unknown }
    if (typeof record.shellId !== 'string') return
    shellKillResults.add(
      `${record.shellId}${typeof record.command === 'string' ? record.command : ''}`,
    )
  }
  const isRedundantClaimedEnding = (event: EventOfType<'background-shell-ended'>): boolean =>
    event.killedBy === EKilledBy.Model &&
    event.output === '' &&
    shellKillResults.has(`${event.shellId}${event.command}`)

  return {
    isRedundantEnding: (event) =>
      isRedundantTeardownEnding(event) || isRedundantClaimedEnding(event),
    noteShellEnding,
    noteToolResult,
  }
}
