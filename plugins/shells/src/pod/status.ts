import { EKilledBy, EShellStatus, type V2Event } from '@dltech/atlas-core'
import { EShellRunStatus, type ShellInfo } from '@dltech/atlas-protocol'

export type ShellOutcome = {
  status: EShellStatus
  killedBy?: EKilledBy | undefined
  exitCode?: number | undefined
}

export const outcomeOf = (info: ShellInfo): ShellOutcome => {
  const exitCode = info.exitCode === null ? undefined : info.exitCode
  if (info.status === EShellRunStatus.Running) return { status: EShellStatus.Running }
  if (info.status === EShellRunStatus.Exited) return { status: EShellStatus.Exited, exitCode }
  if (info.status === EShellRunStatus.Killed) return { status: EShellStatus.Killed, exitCode }
  if (info.status === EShellRunStatus.TimedOut) {
    return { status: EShellStatus.Killed, killedBy: EKilledBy.Timeout, exitCode }
  }
  return { status: EShellStatus.Overflowed, exitCode }
}

export type StartedShell = { description?: string | undefined; command: string }

export const startedOf = (args: {
  events: readonly V2Event[]
  shellId: string
}): StartedShell | undefined => {
  for (const event of args.events) {
    if (event.type === 'background-shell-started' && event.shellId === args.shellId) {
      return { command: event.command, description: event.description }
    }
  }
  return undefined
}

export const hasEnded = (args: { events: readonly V2Event[]; shellId: string }): boolean =>
  args.events.some(
    (event) => event.type === 'background-shell-ended' && event.shellId === args.shellId,
  )
