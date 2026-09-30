import {
  EKilledBy,
  EShellStatus,
  lostShellsOf,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { bootId } from './boot'
import type { ShellSnapshot } from './background-shell'

export type LostShell = {
  shellId: string
  command: string
  description?: string | undefined
}

export type LiveShell = {
  shellId: string
  threadId: ThreadId
}

/**
 * A background shell outlives the process that ran it, because the record of it does. A start with
 * no end behind it means the process died while the shell was running: a clean close records an end
 * for every live shell, so the absence of one is a crash or a kill. The pairing that decides "no end
 * behind it" lives in core (`lostShellsOf`), shared with teardown and the transcript so the three
 * never disagree; this class owns only the I/O of reading the log and appending the synthetic end.
 */
export class ShellRecovery {
  private readonly log: EventLogPort
  private readonly ids: IdPort
  private readonly live: (() => readonly LiveShell[] | undefined) | undefined
  private readonly inflight = new Map<ThreadId, Promise<readonly LostShell[]>>()

  constructor(args: {
    log: EventLogPort
    ids: IdPort
    live?: (() => readonly LiveShell[] | undefined) | undefined
  }) {
    this.log = args.log
    this.ids = args.ids
    this.live = args.live
  }

  recordLost(args: { threadId: ThreadId }): Promise<readonly LostShell[]> {
    const { threadId } = args
    const running = this.inflight.get(threadId)
    if (running !== undefined) return running

    const attempt = this.reconcile({ threadId }).finally(() => {
      this.inflight.delete(threadId)
    })
    this.inflight.set(threadId, attempt)
    return attempt
  }

  private async reconcile(args: { threadId: ThreadId }): Promise<readonly LostShell[]> {
    const { threadId } = args
    const events = await this.log.readOwn({ threadId })
    const lost = this.unresolvedBeforeThisBoot(lostShellsOf(events))
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

  private unresolvedBeforeThisBoot(
    lost: ReturnType<typeof lostShellsOf>,
  ): ReturnType<typeof lostShellsOf> {
    const beforeThisBoot = lost.filter((shell) => shell.bootId !== bootId)
    const live = this.live?.()
    if (live === undefined) return beforeThisBoot

    const liveKeys = new Set(live.map((shell) => `${shell.threadId} ${shell.shellId}`))
    return beforeThisBoot.filter(
      (shell) =>
        shell.bootId !== undefined ||
        !liveKeys.has(`${shell.started.threadId} ${shell.shellId}`),
    )
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

export const liveShellsOf = (snapshots: readonly ShellSnapshot[]): readonly LiveShell[] =>
  snapshots
    .filter((snapshot) => snapshot.endedAt === undefined)
    .map((snapshot) => ({ shellId: snapshot.shellId, threadId: snapshot.threadId }))
