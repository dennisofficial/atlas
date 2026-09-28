import {
  EKilledBy,
  EShellStatus,
  type Event,
  type EventLogPort,
  type EventOfType,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

export type LostShell = {
  shellId: string
  command: string
  description?: string | undefined
}

type StartedShell = EventOfType<'background-shell-started'>

function openShells(events: readonly Event[]): StartedShell[] {
  const open = new Map<string, StartedShell[]>()

  for (const event of events) {
    if (event.type === 'background-shell-started') {
      const queue = open.get(event.shellId) ?? []
      queue.push(event)
      open.set(event.shellId, queue)
      continue
    }
    if (event.type !== 'background-shell-ended') continue
    open.get(event.shellId)?.shift()
  }

  return [...open.values()].flat()
}

/**
 * The one place "needs an ending" is decided, shared by teardown and the next boot's recovery so
 * the two never disagree. A compacted log holds no shell starts, so nothing about it is open; a
 * start with its ending still present is settled. Only a genuinely unpaired start counts.
 */
export const openShellIdsOf = (events: readonly Event[]): ReadonlySet<string> =>
  new Set(openShells(events).map((shell) => shell.shellId))

/**
 * A background shell outlives the process that ran it, because the record of it does. A start with
 * no ending behind it means the process died while the shell was running: a clean close records an
 * ending for every live shell, so the absence of one is a crash or a kill. Ids repeat across boots
 * (bash_1 restarts every process), so starts and ends pair chronologically, not by id alone. Runs
 * once per thread per process — a revisit finds every ending already written and settles nothing.
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
    const lost = openShells(events)
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
}): {
  type: 'background-shell-ended'
  shellId: string
  command: string
  description?: string | undefined
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
    status: EShellStatus.Killed,
    killedBy: EKilledBy.Unrecorded,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
  }
}
