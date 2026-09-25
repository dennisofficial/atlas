import type { EKilledBy, EventDraft, ThreadId } from '@dltech/atlas-core'
import {
  ShellRegistryPort,
  type PendingShellNotice,
  type ShellKillOutcome,
  type ShellReadOutcome,
  type ShellSnapshot,
  type StartedShellOutcome,
  type StartShellArgs,
} from '@dltech/atlas-harness'

import { heldIfSame, shellsFor, type SharedRoster } from './roster-reader'

const remoteActionRefused = (reason: string): { ok: false; reason: string } => ({
  ok: false,
  reason,
})

const NO_PENDING_SHELL_NOTICES: readonly PendingShellNotice[] = Object.freeze([])

/**
 * The shell registry as a cloud session's surfaces read it: the roster the sandbox's serve pushes
 * over the channel. The sandbox owns the processes, so anything that would touch one — start,
 * kill, a cursor read — refuses in words rather than pretending to work locally. Peek has nothing
 * to tail from: output never rides the roster frames, so the drawer stays empty rather than
 * showing a stale local fragment.
 */
export class RemoteShellRegistry extends ShellRegistryPort {
  private heldEverywhere: readonly ShellSnapshot[] = []
  private readonly scoped = new Map<ThreadId, readonly ShellSnapshot[]>()
  private revision = 0

  constructor(private readonly roster: SharedRoster) {
    super()
    roster.subscribe(() => this.sync())
    this.sync()
  }

  private sync(): void {
    const latest = this.roster.current().shells
    const held = heldIfSame(this.heldEverywhere, latest)
    if (held === this.heldEverywhere) return

    this.heldEverywhere = Object.freeze(held.slice())
    this.scoped.clear()
    this.revision += 1
  }

  listEverywhere(): readonly ShellSnapshot[] {
    return this.heldEverywhere
  }

  start(_args: StartShellArgs): StartedShellOutcome {
    return remoteActionRefused('a cloud session starts shells in its sandbox, not on this machine')
  }

  read(_args: { shellId: string; threadId: ThreadId }): ShellReadOutcome {
    return remoteActionRefused('a cloud session reads shell output in its sandbox, not on this machine')
  }

  peek(_args: { shellId: string; characters: number; threadId: ThreadId }): string | undefined {
    return undefined
  }

  kill(_args: { shellId: string; by: EKilledBy; threadId: ThreadId }): ShellKillOutcome {
    return remoteActionRefused('a cloud session kills shells in its sandbox, not on this machine')
  }

  async awaitEndings(_args: { threadId: ThreadId; ms: number }): Promise<number> {
    return 0
  }

  removeShells(_args: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): void {}

  list(args: { threadId: ThreadId }): readonly ShellSnapshot[] {
    const held = this.scoped.get(args.threadId)
    const latest = shellsFor({ roster: this.roster.current(), threadId: args.threadId })
    if (held !== undefined && heldIfSame(held, latest) === held) return held

    const frozen = Object.freeze(latest.slice())
    this.scoped.set(args.threadId, frozen)
    return frozen
  }

  version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    return this.roster.subscribe(listener)
  }

  drainNotifications(_args: { threadId: ThreadId }): readonly EventDraft[] {
    return []
  }

  pendingNotices(_args: { threadId: ThreadId }): readonly PendingShellNotice[] {
    return NO_PENDING_SHELL_NOTICES
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return []
  }

  onNotice(_listener: () => void): () => void {
    return () => undefined
  }

  forgetNotices(_args: { threadId: ThreadId }): void {}

  async closeAll(): Promise<void> {}
}
