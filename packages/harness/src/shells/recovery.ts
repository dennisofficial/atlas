import {
  EKilledBy,
  EShellStatus,
  lostShellsOf,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

export type LostShell = {
  shellId: string
  command: string
  description?: string | undefined
}

/**
 * A background shell outlives the process that ran it, because the record of it does. A start with
 * no end behind it means the process died while the shell was running: a clean close records an end
 * for every live shell, so the absence of one is a crash or a kill. The pairing that decides "no end
 * behind it" lives in core (`lostShellsOf`), shared with teardown and the transcript so the three
 * never disagree; this class owns only the I/O of reading the log and appending the synthetic end,
 * and the once-per-thread guard that keeps a revisit free.
 */
export class ShellRecovery {
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly reconciled = new Set<ThreadId>()

  constructor(args: { log: EventLogPort; ids: IdPort }) {
    this.log = args.log
    this.ids = args.ids
  }

  async recordLost(args: { threadId: ThreadId }): Promise<readonly LostShell[]> {
    const { threadId } = args
    if (this.reconciled.has(threadId)) return []
    this.reconciled.add(threadId)

    const events = await this.log.readOwn({ threadId })
    const lost = lostShellsOf(events)
    if (lost.length === 0) return []

    await this.log.append({
      threadId,
      runId: this.ids.nextRunId(),
      drafts: lost.map(lostShellEnding),
    })

    return lost.map((shell) => ({
      shellId: shell.shellId,
      command: shell.command,
      description: shell.description,
    }))
  }
}

export function lostShellEnding(shell: {
  shellId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
}): {
  type: 'background-shell-ended'
  shellId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
  status: EShellStatus
  killedBy: EKilledBy
  output: string
  droppedCharacters: number
  remainingCharacters: number
} {
  return {
    type: 'background-shell-ended',
    shellId: shell.shellId,
    command: shell.command,
    description: shell.description,
    bootId: shell.bootId,
    status: EShellStatus.Killed,
    killedBy: EKilledBy.Unrecorded,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
  }
}
