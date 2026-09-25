import type { EKilledBy, EventDraft, ThreadId } from '@dltech/atlas-core'
import {
  ServiceRegistryPort,
  type ServiceSnapshot,
  type StartedServiceOutcome,
  type ServiceStopOutcome,
} from '@dltech/atlas-harness'

import { heldIfSame, type SharedRoster } from './roster-reader'

const NO_PENDING_SERVICES: readonly ServiceSnapshot[] = Object.freeze([])

/**
 * The service registry as a cloud session's surfaces read it: the roster the sandbox's serve
 * pushes over the channel. Services are session-global infrastructure owned by the sandbox, so
 * start and stop refuse rather than touching a process on the wrong machine.
 */
export class RemoteServiceRegistry extends ServiceRegistryPort {
  private held: readonly ServiceSnapshot[] = []
  private revision = 0

  constructor(private readonly roster: SharedRoster) {
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
    return { ok: false, reason: 'a cloud session starts services in its sandbox, not on this machine' }
  }

  stop(_args: { serviceId: string; by: EKilledBy }): ServiceStopOutcome {
    return { ok: false, reason: 'a cloud session stops services in its sandbox, not on this machine' }
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

  async closeAll(): Promise<void> {}
}
