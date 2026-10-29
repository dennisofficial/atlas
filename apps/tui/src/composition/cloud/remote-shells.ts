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

import {
  killShell,
  readShellOutput,
  startShell,
  type RequestChannel,
} from '@dltech/atlas-client/channel'

import { heldIfSame, shellsFor, type SharedRoster } from './roster-reader'

const remoteActionRefused = (reason: string): { ok: false; reason: string } => ({
  ok: false,
  reason,
})

const NO_PENDING_SHELL_NOTICES: readonly PendingShellNotice[] = Object.freeze([])

const unknownShape = (action: string): { ok: false; reason: string } =>
  remoteActionRefused(`the sandbox answered the ${action} with a shape this build does not know`)

export class RemoteShellRegistry extends ShellRegistryPort {
  private heldEverywhere: readonly ShellSnapshot[] = []
  private readonly scoped = new Map<ThreadId, readonly ShellSnapshot[]>()
  private revision = 0

  constructor(
    private readonly roster: SharedRoster,
    private readonly channel: RequestChannel,
  ) {
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

  async start(args: StartShellArgs): Promise<StartedShellOutcome> {
    try {
      return await startShell({
        channel: this.channel,
        threadId: args.threadId,
        command: args.command,
        description: args.description,
        cwd: args.cwd,
      })
    } catch {
      return unknownShape('start')
    }
  }

  read(_args: { shellId: string; threadId: ThreadId }): ShellReadOutcome {
    return remoteActionRefused(
      'a cloud session reads shell output in its sandbox, not on this machine',
    )
  }

  async peek(args: {
    shellId: string
    characters: number
    threadId: ThreadId
  }): Promise<string | undefined> {
    try {
      const reply = await readShellOutput({ channel: this.channel, ...args })
      return reply.ok ? reply.text : undefined
    } catch {
      return undefined
    }
  }

  async kill(args: {
    shellId: string
    by: EKilledBy
    threadId: ThreadId
  }): Promise<ShellKillOutcome> {
    try {
      return await killShell({
        channel: this.channel,
        threadId: args.threadId,
        shellId: args.shellId,
      })
    } catch {
      return unknownShape('kill')
    }
  }

  async awaitEndings(_args: { threadId: ThreadId; ms: number }): Promise<number> {
    return 0
  }

  removeShells(_args: { threadId: ThreadId; shellIds: readonly string[]; by: EKilledBy }): void {}

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

  reassignNotices(_args: { from: ThreadId; to: ThreadId }): void {}

  async closeAll(): Promise<void> {}
}
