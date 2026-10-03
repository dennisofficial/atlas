import {
  EKilledBy,
  EShellStatus,
  lostShellsOf,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store/thread-store'
import { bootId } from './boot'
import type { ShellSnapshot } from './background-shell'
import { ShellEventJournal } from './journal'
import { EInspected, type LostShell, type ShellExit, type ShellLauncherPort } from './port'
import type { RegistryState } from './registry-entries'
import type { ShellEvents } from './registry-events'
import type { ShellLifecycle } from './registry-lifecycle'
import { loadCursor } from './output-preview'
import { toShellId } from './shell-id'

export type { LostShell }

export type LiveShell = {
  shellId: string
  threadId: ThreadId
}

type LostEntry = ReturnType<typeof lostShellsOf>[number]

export type ReconcileSession = {
  state: RegistryState
  lifecycle: ShellLifecycle
  events: ShellEvents
  launcher?: ShellLauncherPort | undefined
}

export type ReconcilerDeps = {
  log: EventLogPort
  journal: ShellEventJournal
  failure: () => string
  warn: (message: string) => void
  session?: ReconcileSession | undefined
  live?: (() => readonly LiveShell[] | undefined) | undefined
  threads?: Pick<ThreadStorePort, 'spawned'> | undefined
}

const NOTHING_PRINTED = { text: '', droppedCharacters: 0, remainingCharacters: 0 }

const unrecordedSnapshot = (args: { threadId: ThreadId; lost: LostEntry }): ShellSnapshot => ({
  shellId: toShellId(args.lost.shellId),
  threadId: args.threadId,
  bootId: args.lost.bootId,
  command: args.lost.command,
  description: args.lost.description ?? '',
  status: EShellStatus.Killed,
  killedBy: EKilledBy.Unrecorded,
  startedAt: args.lost.started.at,
  lastOutputAt: args.lost.started.at,
  totalCharacters: 0,
  awaitingInput: false,
})

export class ShellReconciler {
  private readonly inflight = new Map<ThreadId, Promise<readonly LostShell[]>>()

  constructor(private readonly deps: ReconcilerDeps) {}

  async reconcile(args: { threadId: ThreadId; ownOnly?: boolean }): Promise<readonly LostShell[]> {
    const owners = new Set<ThreadId>([args.threadId])
    if (args.ownOnly !== true && this.deps.threads !== undefined) {
      for (const threadId of owners) {
        for (const child of await this.deps.threads.spawned({ threadId })) owners.add(child.id)
      }
    }
    const recovered = await Promise.all([...owners].map((threadId) => this.reconcileOwn({ threadId })))
    return recovered.flat()
  }

  private reconcileOwn(args: { threadId: ThreadId }): Promise<readonly LostShell[]> {
    const running = this.inflight.get(args.threadId)
    if (running !== undefined) return running

    const attempt = this.run(args).finally(() => {
      this.inflight.delete(args.threadId)
    })
    this.inflight.set(args.threadId, attempt)
    return attempt
  }

  private async run(args: { threadId: ThreadId }): Promise<readonly LostShell[]> {
    const { threadId } = args
    const events = await this.deps.log.readOwn({ threadId })
    await this.retryFailedEndings({ threadId })
    const lost = this.unresolved({ threadId, lost: lostShellsOf(events) })
    if (lost.length === 0) return []

    const inspected = new Map(
      ((await this.deps.session?.launcher?.inspect({ threadId })) ?? []).map((shell) => [
        shell.shellId as string,
        shell,
      ]),
    )
    const unrecorded: LostShell[] = []
    for (const shell of lost) {
      const reason = await this.settle({ threadId, shell, found: inspected.get(shell.shellId) })
      if (reason !== undefined) {
        unrecorded.push({
          shellId: shell.shellId,
          command: shell.command,
          description: shell.description,
          ...(reason === '' ? {} : { reason }),
        })
      }
    }
    return unrecorded
  }

  private unresolved(args: { threadId: ThreadId; lost: LostEntry[] }): LostEntry[] {
    const { session, live } = this.deps
    const liveKeys = new Set((live?.() ?? []).map((shell) => `${shell.threadId} ${shell.shellId}`))
    return args.lost.filter((shell) => {
      if (session?.state.entryFor({ shellId: shell.shellId, threadId: args.threadId }) !== undefined) {
        return false
      }
      if (shell.bootId === bootId) return false
      if (live === undefined || shell.bootId !== undefined) return true
      return !liveKeys.has(`${args.threadId} ${shell.shellId}`)
    })
  }

  private async settle(args: {
    threadId: ThreadId
    shell: LostEntry
    found: Awaited<ReturnType<ShellLauncherPort['inspect']>>[number] | undefined
  }): Promise<string | undefined> {
    const { session } = this.deps
    const { found, shell, threadId } = args
    if (found?.state === EInspected.Corrupt) {
      this.deps.warn(`shell ${shell.shellId} is corrupt: ${found.reason} — it stays unresolved until the directory is repaired or removed`)
      return found.reason
    }
    if (session === undefined || found === undefined) {
      await this.recordUnrecorded({ threadId, shell })
      return ''
    }

    const { attachment } = found
    const loaded = await loadCursor({ path: attachment.cursorPath })
    if (loaded.problem !== undefined) this.deps.warn(loaded.problem)
    const finished: ShellExit | undefined = found.state === EInspected.Finished ? found.exit : undefined
    const entry = session.lifecycle.open({
      attachment,
      threadId,
      bootId: shell.bootId,
      command: shell.command,
      description: shell.description ?? '',
      cursor: loaded.cursor,
      finished,
    })
    if (finished === undefined) return undefined

    await entry.shell.exited
    await session.state.endings.get(entry.shell.shellId)
    return undefined
  }

  private async retryFailedEndings(args: { threadId: ThreadId }): Promise<void> {
    const { state, events } = this.deps.session ?? { state: undefined, events: undefined }
    if (state === undefined || events === undefined) return
    for (const id of [...state.failedEndings]) {
      const entry = state.tracked.get(id)
      if (entry === undefined || entry.threadId !== args.threadId) continue
      if (entry.shell.snapshot().status === EShellStatus.Running) continue
      const recorded = await events.recordEnding(entry)
      if (recorded === undefined || !recorded.appended) continue
      state.failedEndings.delete(id)
      entry.reaped = true
      state.noteReaped(id)
    }
  }

  private async recordUnrecorded(args: { threadId: ThreadId; shell: LostEntry }): Promise<void> {
    const { threadId, shell } = args
    const written = await this.deps.journal.ended({
      threadId,
      shellId: toShellId(shell.shellId),
      snapshot: unrecordedSnapshot({ threadId, lost: shell }),
      occurrenceId: shell.started.id,
      delta: NOTHING_PRINTED,
      hooked: [],
    })
    if (!written.appended) throw new Error(this.deps.failure())
  }
}

export class ShellRecovery {
  private readonly reconciler: ShellReconciler

  constructor(args: {
    log: EventLogPort
    ids: IdPort
    live?: (() => readonly LiveShell[] | undefined) | undefined
  }) {
    let lastWarning = 'could not record the ending of a lost shell'
    const warn = (message: string): void => {
      lastWarning = message
    }
    this.reconciler = new ShellReconciler({
      log: args.log,
      journal: new ShellEventJournal({ log: args.log, ids: args.ids, warn }),
      failure: () => lastWarning,
      warn,
      live: args.live,
    })
  }

  recordLost(args: { threadId: ThreadId }): Promise<readonly LostShell[]> {
    return this.reconciler.reconcile(args)
  }
}

export const liveShellsOf = (snapshots: readonly ShellSnapshot[]): readonly LiveShell[] =>
  snapshots
    .filter((snapshot) => snapshot.endedAt === undefined)
    .map((snapshot) => ({ shellId: snapshot.shellId, threadId: snapshot.threadId }))
