import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import {
  EKilledBy,
  EServiceStatus,
  type ClockPort,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  ensureDeclaredServices,
  type EnsuredService,
  type DeclaredEnsureOptions,
} from './declared-ensure'
import { ServiceChangeFeed } from './service-change-feed'
import { ServiceEndings, type TrackedService } from './service-endings'
import { ServiceEventJournal, type ServiceStartRecording } from './service-journal'
import { ServiceNoticeRegistry } from './service-notice-registry'
import {
  SERVICE_SETTLE_MS,
  startService,
  type Service,
  type ServiceSnapshot,
} from './service-process'
import type {
  ServiceStartArgs,
  ServiceStopOutcome,
  StartedServiceOutcome,
} from './service-registry-port'
import { serviceLogTail } from './service-log-tail'
import {
  awaitServiceEndings,
  CLOSE_GRACE_MS,
  KILLED_GRACE_MS,
  stopAllServices,
} from './service-teardown'
import { startedDraftOf } from './service-started-draft'
import { unknownService, within } from './service-registry-support'
import { ServiceRestarter } from './service-restarter'
import type { Scheduler } from './service-supervisor'

export * from './service-registry-port'
export type { ServiceStartRecording } from './service-journal'

export * from './service-teardown'

export class BunServiceRegistry extends ServiceNoticeRegistry {
  private readonly tracked = new Map<string, TrackedService>()
  private readonly endings: ServiceEndings
  private readonly journal: ServiceEventJournal | undefined
  private readonly feed = new ServiceChangeFeed()
  private readonly restarter: ServiceRestarter
  private readonly ensuring = new Map<string, Promise<EnsuredService>>()
  /**
   * Ids restart at svc_1 in every session, but the log directory is shared — the token keeps two
   * live sessions from writing the same file, and the shim resolves a bare id to its newest match.
   */
  private readonly sessionToken = randomUUID().slice(0, 8)
  private started = 0
  private recordingStarts = 0

  private readonly root: string
  private readonly clock: ClockPort
  private readonly logsDirectory: string
  private readonly processes: ProcessPort
  private readonly declared: DeclaredEnsureOptions | undefined
  constructor(args: {
    root: string
    clock: ClockPort
    logsDirectory: string
    processes: ProcessPort
    recording?: ServiceStartRecording | undefined
    warn?: ((message: string) => void) | undefined
    scheduler?: Scheduler | undefined
    declared?: DeclaredEnsureOptions | undefined
  }) {
    super({ scheduler: args.scheduler })
    this.root = args.root
    this.clock = args.clock
    this.logsDirectory = args.logsDirectory
    this.processes = args.processes
    this.declared = args.declared
    this.restarter = new ServiceRestarter({
      supervisor: this.supervisor,
      clock: args.clock,
      relaunch: (launch) => this.launch(launch),
    })
    this.journal =
      args.recording === undefined
        ? undefined
        : new ServiceEventJournal({
            recording: args.recording,
            warn: args.warn ?? (() => undefined),
          })
    this.endings = new ServiceEndings({
      journal: this.journal,
      notices: this.notices,
      isCurrent: (entry) => this.tracked.get(entry.service.serviceId) === entry,
      onAnnounced: () => this.feed.bump(),
      onChanged: () => {
        if (!this.settling()) this.feed.announceSettled()
      },
    })
  }

  async start(args: ServiceStartArgs): Promise<StartedServiceOutcome> {
    if (args.name !== undefined) this.supervisor.forget(args.name)
    return this.launch(args)
  }

  private async launch(args: ServiceStartArgs): Promise<StartedServiceOutcome> {
    this.started += 1
    const serviceId = `svc_${this.started}`

    const opened = startService({
      serviceId,
      command: args.command,
      description: args.description,
      cwd: args.cwd ?? this.root,
      logPath: join(this.logsDirectory, `${serviceId}.${this.sessionToken}.log`),
      clock: this.clock,
      processes: this.processes,
      threadId: args.threadId,
      exposure: args.exposure,
      env: args.env,
      name: args.name,
      port: args.port,
      onExit: (service) => this.announceExit(service),
    })
    if (!opened.ok) return opened

    this.tracked.set(serviceId, {
      service: opened.service,
      threadId: args.threadId,
      launch: args,
      announced: false,
    })
    this.feed.bump()
    this.recordStart({ serviceId, args })

    void opened.service.exited.finally(() => {
      if (!this.settling()) this.feed.announceSettled()
    })

    await within(SERVICE_SETTLE_MS, opened.service.exited)

    return { ok: true, snapshot: opened.service.snapshot() }
  }

  override async restart({ serviceId }: { serviceId: string }): Promise<StartedServiceOutcome> {
    const entry = this.tracked.get(serviceId)
    if (entry === undefined) {
      return { ok: false, reason: unknownService({ serviceId, known: [...this.tracked.keys()] }) }
    }

    const { name } = entry.launch
    if (name !== undefined) this.supervisor.forget(name)
    entry.service.stop(EKilledBy.Model)
    await within(KILLED_GRACE_MS + CLOSE_GRACE_MS, entry.service.exited)
    return this.start(entry.launch)
  }

  override ensureDeclared(args: {
    threadId: ThreadId
    names?: readonly string[] | undefined
  }): Promise<readonly EnsuredService[]> {
    return ensureDeclaredServices({
      ...args,
      services: this,
      processes: this.processes,
      root: this.root,
      inflight: this.ensuring,
      options: this.declared,
    })
  }

  version(): number {
    return this.feed.version()
  }

  subscribe(listener: () => void): () => void {
    return this.feed.subscribe(listener)
  }

  override settling(): boolean {
    return (
      this.recordingStarts > 0 ||
      [...this.tracked.values()].some(
        (entry) => entry.service.snapshot().status !== EServiceStatus.Running && !entry.announced,
      )
    )
  }

  override onSettled(listener: () => void): () => void {
    return this.feed.onSettled(listener)
  }

  stop({ serviceId, by }: { serviceId: string; by: EKilledBy }): ServiceStopOutcome {
    const entry = this.tracked.get(serviceId)
    if (entry === undefined) {
      return { ok: false, reason: unknownService({ serviceId, known: [...this.tracked.keys()] }) }
    }

    if (entry.launch.name !== undefined) this.supervisor.cancel(entry.launch.name)
    const action = entry.service.stop(by)
    return { ok: true, snapshot: entry.service.snapshot(), action }
  }

  awaitEndings({ ms }: { ms: number }): Promise<number> {
    return awaitServiceEndings({ entries: [...this.tracked.values()], ms })
  }

  override async retryEndings(args: { threadId?: ThreadId | undefined }): Promise<void> {
    const failed = [...this.tracked.values()].filter(
      (entry) =>
        (args.threadId === undefined || entry.threadId === args.threadId) &&
        this.endings.needsRetry(entry),
    )
    await Promise.all(failed.map((entry) => this.endings.persist(entry)))
  }

  removeServices({ serviceIds, by }: { serviceIds: readonly string[]; by: EKilledBy }): void {
    let removed = false
    for (const serviceId of serviceIds) {
      const entry = this.tracked.get(serviceId)
      if (entry === undefined) continue
      if (entry.launch.name !== undefined) this.supervisor.forget(entry.launch.name)
      entry.announced = true
      this.endings.disown(entry)
      if (entry.service.snapshot().status === EServiceStatus.Running) entry.service.stop(by)
      this.tracked.delete(serviceId)
      removed = true
    }
    if (!removed) return
    this.notices.dropServices({ serviceIds })
    this.feed.bump()
  }

  list(): readonly ServiceSnapshot[] {
    return [...this.tracked.values()].map((entry) => entry.service.snapshot())
  }

  override logTail(args: { serviceId: string; characters: number }): string {
    return serviceLogTail({ services: this, ...args })
  }

  override hasRunningFor({ threadId }: { threadId: ThreadId }): boolean {
    return this.runningFor({ threadId }).length > 0
  }

  override runningFor({ threadId }: { threadId: ThreadId }): readonly ServiceSnapshot[] {
    return [...this.tracked.values()]
      .filter((entry) => entry.threadId === threadId)
      .map((entry) => entry.service.snapshot())
      .filter((snapshot) => snapshot.status === EServiceStatus.Running)
  }

  /**
   * Teardown stops everything but suppresses nothing: every ending is recorded to its thread's log
   * before this resolves, and a recording that failed gets one more attempt.
   */
  async closeAll(args?: { killedBy?: EKilledBy }): Promise<void> {
    this.restarter.close()
    await stopAllServices({
      entries: [...this.tracked.values()],
      killedBy: args?.killedBy ?? EKilledBy.SessionEnd,
      retry: () => this.retryEndings({}),
    })
    this.tracked.clear()
    this.feed.clear()
  }

  private recordStart(args: { serviceId: string; args: ServiceStartArgs }): void {
    if (this.journal === undefined) return
    this.recordingStarts += 1
    void this.journal
      .started({
        threadId: args.args.threadId,
        serviceId: args.serviceId,
        draft: startedDraftOf(args),
      })
      .finally(() => {
        this.recordingStarts -= 1
        if (!this.settling()) this.feed.announceSettled()
      })
  }

  private announceExit(service: Service): void {
    const entry = this.tracked.get(service.serviceId)
    if (entry === undefined) return

    const { name } = entry.launch
    if (name !== undefined && service.snapshot().status === EServiceStatus.Exited) {
      this.restarter.crashed({ launch: entry.launch, name, logPath: service.logPath })
    }
    this.endings.exited(entry)
  }
}
