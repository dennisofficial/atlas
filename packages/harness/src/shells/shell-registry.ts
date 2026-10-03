import {
  EKilledBy,
  type ClockPort,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { HookChainSource } from '../hooks/registry'
import type { InputBatch } from '../intake/input-batch'
import type { SleepPrevention } from '../power/sleep-prevention'
import type { ThreadStorePort } from '../store/thread-store'
import type { PendingShellNotice } from './attention'
import type {
  ShellInputOutcome,
  ShellKillOutcome,
  ShellSnapshot,
  StartedShellOutcome,
  StartShellArgs,
} from './background-shell'
import { ShellEventJournal } from './journal'
import { DELIVERED_CHARACTERS, ENDED_READ_BYTES } from './output-preview'
import {
  ShellRegistryPort,
  type LostShell,
  type ShellLauncherPort,
  type ShellReadOutcome,
} from './port'
import { ShellReconciler } from './recovery'
import {
  RegistryState,
  SILENT_FOR_AT_MOST_MS,
  unknownShell,
} from './registry-entries'
import { ShellEvents } from './registry-events'
import { ShellLifecycle } from './registry-lifecycle'
import { closeAllShells, detachAllShells, removeShells } from './registry-teardown'
import { EShellStatus } from './background-shell'

export {
  ACTIVITY_NOTIFY_MS,
  KILL_SETTLE_MS,
  PROMPT_SETTLE_MS,
  RETAINED_ENDED_SHELLS,
  SILENT_FOR_AT_MOST_MS,
} from './registry-entries'
export { ShellRegistryPort } from './port'
export type { ShellReadOutcome } from './port'

export type ShellRegistryDeps = {
  root: string
  clock: ClockPort
  hooks: HookChainSource
  launcher?: ShellLauncherPort | undefined
  sleepPrevention?: SleepPrevention | undefined
  log?: EventLogPort | undefined
  ids?: IdPort | undefined
  silenceMs?: number | undefined
  operations?: LogPort | undefined
  threads?: Pick<ThreadStorePort, 'spawned'> | undefined
}

export class BunShellRegistry extends ShellRegistryPort {
  private readonly admittedOwners = new Set<ThreadId>()
  private readonly state: RegistryState
  private readonly lifecycle: ShellLifecycle
  private readonly reconciler: ShellReconciler | undefined

  constructor(deps: ShellRegistryDeps) {
    super()
    const warn = (message: string): void =>
      deps.operations?.warn({ source: 'shells.journal', message })
    const journal =
      deps.log !== undefined && deps.ids !== undefined
        ? new ShellEventJournal({ log: deps.log, ids: deps.ids, warn })
        : undefined
    this.state = new RegistryState(journal)
    const events = new ShellEvents(this.state, deps.hooks)
    this.lifecycle = new ShellLifecycle({
      state: this.state,
      events,
      clock: deps.clock,
      root: deps.root,
      silenceMs: deps.silenceMs ?? SILENT_FOR_AT_MOST_MS,
      launcher: deps.launcher,
      sleepPrevention: deps.sleepPrevention,
    })
    this.reconciler =
      deps.log === undefined || journal === undefined
        ? undefined
        : new ShellReconciler({
            log: deps.log,
            threads: deps.threads,
            journal,
            failure: () => 'could not record the ending of a lost shell',
            warn,
            session: {
              state: this.state,
              lifecycle: this.lifecycle,
              events,
              launcher: deps.launcher,
            },
          })
  }

  start(args: StartShellArgs): Promise<StartedShellOutcome> {
    this.admittedOwners.add(args.threadId)
    return this.lifecycle.start(args)
  }

  async read(args: { shellId: string; threadId: ThreadId }): Promise<ShellReadOutcome> {
    const entry = this.state.entryFor(args)
    if (entry === undefined) return this.unknown(args)

    const running = entry.shell.snapshot().status === EShellStatus.Running
    const delta = await entry.shell.consume(running ? DELIVERED_CHARACTERS : ENDED_READ_BYTES)
    return { ok: true, snapshot: entry.shell.snapshot(), delta }
  }

  async peek(args: {
    shellId: string
    characters: number
    threadId: ThreadId
  }): Promise<string | undefined> {
    return await this.state.entryFor(args)?.shell.tail(args.characters)
  }

  kill(args: { shellId: string; by: EKilledBy; threadId: ThreadId }): ShellKillOutcome {
    const entry = this.state.entryFor(args)
    if (entry === undefined) return this.unknown(args)
    return this.lifecycle.kill({ entry, by: args.by })
  }

  override async writeInput(args: {
    threadId: ThreadId
    shellId: string
    text: string
    end?: boolean | undefined
  }): Promise<ShellInputOutcome> {
    const entry = this.state.entryFor(args)
    if (entry === undefined) return this.unknown(args)
    return await entry.shell.writeInput({ text: args.text, end: args.end })
  }

  awaitEndings(args: { threadId: ThreadId; ms: number }): Promise<number> {
    return this.lifecycle.awaitEndings(args)
  }

  removeShells(args: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): Promise<void> {
    return removeShells({ state: this.state, ...args })
  }

  override reconcile(args: { threadId: ThreadId; ownOnly?: boolean }): Promise<readonly LostShell[]> {
    this.admittedOwners.add(args.threadId)
    return this.reconciler?.reconcile(args) ?? Promise.resolve([])
  }

  list({ threadId }: { threadId: ThreadId }): readonly ShellSnapshot[] {
    return [...this.state.tracked.values()]
      .filter((entry) => entry.threadId === threadId)
      .map((entry) => entry.shell.snapshot())
  }

  listEverywhere(): readonly ShellSnapshot[] {
    return [...this.state.tracked.values()].map((entry) => entry.shell.snapshot())
  }

  version(): number {
    return this.state.version()
  }

  subscribe(listener: () => void): () => void {
    return this.state.subscribe(listener)
  }

  override settling(): boolean {
    return this.state.settling()
  }

  override onSettled(listener: () => void): () => void {
    this.state.settledListeners.add(listener)
    return () => this.state.settledListeners.delete(listener)
  }

  drainNotifications({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    this.state.notices.prepare({ threadId }).acknowledge()
    return []
  }

  override prepareNotifications({ threadId }: { threadId: ThreadId }): InputBatch {
    return this.state.notices.prepare({ threadId })
  }

  pendingNotices({ threadId }: { threadId: ThreadId }): readonly PendingShellNotice[] {
    return this.state.notices.pending({ threadId })
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return this.state.notices.threadsAwaiting()
  }

  override threadsWithPendingInput(): readonly ThreadId[] {
    return this.state.notices.threadsQueued()
  }

  onNotice(listener: () => void): () => void {
    return this.state.notices.onNotice(listener)
  }

  forgetNotices({ threadId }: { threadId: ThreadId }): void {
    this.state.notices.forget({ threadId })
  }

  async closeAll(args?: { killedBy?: EKilledBy; threadId?: ThreadId }): Promise<void> {
    const owners = new Set(this.admittedOwners)
    if (args?.threadId !== undefined) owners.add(args.threadId)
    for (const entry of this.state.tracked.values()) owners.add(entry.threadId)
    return closeAllShells({
      state: this.state,
      killedBy: args?.killedBy ?? EKilledBy.SessionEnd,
      prepare: async () => {
        for (const threadId of owners) await this.reconcile({ threadId })
      },
    })
  }

  override detachAll(): Promise<void> {
    return detachAllShells(this.state)
  }

  private unknown(args: { shellId: string; threadId: ThreadId }): { ok: false; reason: string } {
    return {
      ok: false,
      reason: unknownShell({ shellId: args.shellId, known: this.state.idsOf(args.threadId) }),
    }
  }
}
