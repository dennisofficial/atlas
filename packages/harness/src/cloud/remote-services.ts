import {
  EDeclaredServiceState,
  EServiceType,
  EStopAction,
  type DeclaredServicesView,
  type EKilledBy,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'
import { EEnsureStatus, type EnsuredService } from '../services/declared-ensure'
import {
  ServiceRegistryPort,
  type StartedServiceOutcome,
  type ServiceStopOutcome,
} from '../services/service-registry-port'
import { type ServiceSnapshot } from '../services/service-process'

import {
  ensureDeclaredServices,
  listDeclaredServices,
  readServiceLog,
  restartService,
  stopService,
  type RequestChannel,
} from '@dltech/atlas-client/channel'

import { heldIfSame, type SharedRoster } from './roster-reader'

const ensureStatusOf = (status: string): EEnsureStatus =>
  Object.values(EEnsureStatus).find((one) => one === status) ?? EEnsureStatus.Unknown

const declaredStateOf = (state: string): EDeclaredServiceState =>
  Object.values(EDeclaredServiceState).find((one) => one === state) ?? EDeclaredServiceState.Stopped

const serviceTypeOf = (type: string | undefined): EServiceType | undefined =>
  Object.values(EServiceType).find((one) => one === type)

const NO_PENDING_SERVICES: readonly ServiceSnapshot[] = Object.freeze([])

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

  override async declared(): Promise<DeclaredServicesView> {
    const reply = await listDeclaredServices({ channel: this.channel })
    if (!reply.ok) throw new Error(reply.reason)
    return {
      services: reply.view.services.map((one) => ({
        ...one,
        state: declaredStateOf(one.state),
        type: serviceTypeOf(one.type),
      })),
      rejections: reply.view.rejections,
    }
  }

  override async ensureDeclared(args: {
    threadId: ThreadId
    names?: readonly string[] | undefined
  }): Promise<readonly EnsuredService[]> {
    const reply = await ensureDeclaredServices({ channel: this.channel, names: args.names })
    if (!reply.ok) throw new Error(reply.reason)
    return reply.results.map((one) => ({ ...one, status: ensureStatusOf(one.status) }))
  }

  override async restart(args: { serviceId: string }): Promise<StartedServiceOutcome> {
    try {
      const reply = await restartService({ channel: this.channel, serviceId: args.serviceId })
      return reply.ok ? { ok: true, snapshot: reply.snapshot } : reply
    } catch {
      return {
        ok: false,
        reason: 'the sandbox answered the restart with a shape this build does not know',
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
