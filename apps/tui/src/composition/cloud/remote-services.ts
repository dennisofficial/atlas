import { EStopAction, type EKilledBy, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import {
  ServiceRegistryPort,
  type ServiceSnapshot,
  type StartedServiceOutcome,
  type ServiceStopOutcome,
} from '@dltech/atlas-harness'

import { readServiceLog, stopService, type RequestChannel } from '@dltech/atlas-client/channel'

import { heldIfSame, type SharedRoster } from './roster-reader'

const NO_PENDING_SERVICES: readonly ServiceSnapshot[] = Object.freeze([])

/**
 * The service registry as a cloud session's surfaces read it: the roster the sandbox's serve
 * pushes over the channel. Services are session-global infrastructure owned by the sandbox, so
 * stop and the log tail forward through the channel to the sandbox's own registry. Start stays
 * refused: only the model starts services, and its tool runs in the sandbox.
 */
export class RemoteServiceRegistry extends ServiceRegistryPort {
  private held: readonly ServiceSnapshot[] = []
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
    const latest = heldIfSame(this.held, this.roster.current().services)
    if (latest === this.held) return

    this.held = Object.freeze(latest.slice())
    this.revision += 1
  }

  async start(_args: {
    threadId: ThreadId
    command: string
    description: string
    cwd?: string | undefined
  }): Promise<StartedServiceOutcome> {
    return {
      ok: false,
      reason: 'a cloud session starts services in its sandbox, not on this machine',
    }
  }

  async stop(args: { serviceId: string; by: EKilledBy }): Promise<ServiceStopOutcome> {
    try {
      const reply = await stopService({ channel: this.channel, serviceId: args.serviceId })
      return reply.ok ? { ok: true, snapshot: reply.snapshot, action: EStopAction.Term } : reply
    } catch {
      return {
        ok: false,
        reason: 'the sandbox answered the stop with a shape this build does not know',
      }
    }
  }

  override async logTail(args: { serviceId: string; characters: number }): Promise<string> {
    try {
      return await readServiceLog({ channel: this.channel, ...args })
    } catch {
      return ''
    }
  }

  async awaitEndings(_args: { ms: number }): Promise<number> {
    return 0
  }

  removeServices(_args: { serviceIds: readonly string[]; by: EKilledBy }): void {}

  list(): readonly ServiceSnapshot[] {
    return this.held
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

  pendingNotices(_args: { threadId: ThreadId }): readonly ServiceSnapshot[] {
    return NO_PENDING_SERVICES
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
