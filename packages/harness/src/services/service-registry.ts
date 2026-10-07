import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import {
  EKilledBy,
  EServiceStatus,
  type ClockPort,
  type EventDraft,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { InputBatch } from '../intake/input-batch'
import { bootId } from './boot'
import { ServiceEndings, type TrackedService } from './service-endings'
import { ServiceEventJournal, type ServiceStartRecording } from './service-journal'
import { ServiceNoticeQueue } from './service-notices'
import {
  SERVICE_SETTLE_MS,
  startService,
  type Service,
  type ServiceSnapshot,
} from './service-process'
import {
  ServiceRegistryPort,
  type ServiceStopOutcome,
  type StartedServiceOutcome,
} from './service-registry-port'
import { diedWithin, unknownService, within } from './service-registry-support'

export * from './service-registry-port'
export type { ServiceStartRecording } from './service-journal'

export const CLOSE_GRACE_MS = 300
export const KILLED_GRACE_MS = 5_000

/** The escalation window plus slack: a stop that outlives this is handed back to the announcement path. */
export const STOP_SETTLE_MS = KILLED_GRACE_MS + 2_000

export class BunServiceRegistry extends ServiceRegistryPort {
  private readonly tracked = new Map<string, TrackedService>()
  private readonly notices: ServiceNoticeQueue
  private readonly endings: ServiceEndings
  private readonly journal: ServiceEventJournal | undefined
  /**
   * Ids restart at svc_1 in every session, but the log directory is shared — the token keeps two
   * live sessions from writing the same file, and the shim resolves a bare id to its newest match.
   */
  private readonly sessionToken = randomUUID().slice(0, 8)
  private started = 0

  private revision = 0
  private readonly listeners = new Set<() => void>()
  private readonly settledListeners = new Set<() => void>()
  private recordingStarts = 0
  private flushQueued = false

  private readonly root: string
  private readonly clock: ClockPort
  private readonly logsDirectory: string
  private readonly processes: ProcessPort
  constructor(args: {
    root: string
    clock: ClockPort
    logsDirectory: string
    processes: ProcessPort
    recording?: ServiceStartRecording | undefined
    warn?: ((message: string) => void) | undefined
  }) {
    super()
    this.root = args.root
    this.clock = args.clock
    this.logsDirectory = args.logsDirectory
    this.processes = args.processes
    this.notices = new ServiceNoticeQueue({ logged: args.recording !== undefined })
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
      onAnnounced: () => this.bump(),
      onChanged: () => {
        if (!this.settling()) this.announceSettled()
      },
    })
  }

  /**
   * The settle wait is not a health check: it exists so a start that was never viable
   * (`command not found`) comes back as an immediate exit rather than a lying "Started".
   */
  async start(args: {
    threadId: ThreadId
    command: string
    description: string
    cwd?: string | undefined
  }): Promise<StartedServiceOutcome> {
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
      onExit: (service) => this.announceExit(service),
    })
    if (!opened.ok) return opened

    this.tracked.set(serviceId, {
      service: opened.service,
      threadId: args.threadId,
      announced: false,
    })
    this.bump()
    this.recordStart({ serviceId, args })

    void opened.service.exited.finally(() => {
      if (!this.settling()) this.announceSettled()
    })

    await within(SERVICE_SETTLE_MS, opened.service.exited)

    return { ok: true, snapshot: opened.service.snapshot() }
  }

  version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  override settling(): boolean {
    return this.recordingStarts > 0 || [...this.tracked.values()].some(
      (entry) => entry.service.snapshot().status !== EServiceStatus.Running && !entry.announced,
    )
  }

  override onSettled(listener: () => void): () => void {
    this.settledListeners.add(listener)
    return () => this.settledListeners.delete(listener)
  }

  private announceSettled(): void {
    for (const listener of [...this.settledListeners]) listener()
  }

  private bump(): void {
    this.revision += 1
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      for (const listener of this.listeners) listener()
    })
  }

  stop({ serviceId, by }: { serviceId: string; by: EKilledBy }): ServiceStopOutcome {
    const entry = this.tracked.get(serviceId)
    if (entry === undefined) {
      return { ok: false, reason: unknownService({ serviceId, known: [...this.tracked.keys()] }) }
    }

    const action = entry.service.stop(by)
    return { ok: true, snapshot: entry.service.snapshot(), action }
  }

  async awaitEndings({ ms }: { ms: number }): Promise<number> {
    const signalled = [...this.tracked.values()].filter(
      (entry) => entry.service.snapshot().status !== EServiceStatus.Running,
    )
    const deaths = await Promise.all(
      signalled.map((entry) =>
        diedWithin(ms, entry.service.exited.then(() => entry.ending)),
      ),
    )
    return deaths.filter((died) => !died).length
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
      entry.announced = true
      this.endings.disown(entry)
      if (entry.service.snapshot().status === EServiceStatus.Running) entry.service.stop(by)
      this.tracked.delete(serviceId)
      removed = true
    }
    if (!removed) return
    this.notices.dropServices({ serviceIds })
    this.bump()
  }

  list(): readonly ServiceSnapshot[] {
    return [...this.tracked.values()].map((entry) => entry.service.snapshot())
  }

  drainNotifications({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    return this.notices.drain({ threadId })
  }

  override prepareNotifications({ threadId }: { threadId: ThreadId }): InputBatch {
    void this.retryEndings({ threadId })
    return this.notices.prepare({ threadId })
  }

  pendingNotices({ threadId }: { threadId: ThreadId }): readonly ServiceSnapshot[] {
    return this.notices.pending({ threadId })
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return this.notices.threadsAwaiting()
  }

  override threadsWithPendingInput(): readonly ThreadId[] {
    return this.notices.threadsQueued()
  }

  onNotice(listener: () => void): () => void {
    return this.notices.onNotice(listener)
  }

  forgetNotices({ threadId: threadIdToForget }: { threadId: ThreadId }): void {
    this.notices.forget({ threadId: threadIdToForget })
  }

  reassignNotices({ from, to }: { from: ThreadId; to: ThreadId }): void {
    this.notices.reassign({ from, to })
  }

  /**
   * Teardown stops everything but suppresses nothing: every ending is recorded to its thread's log
   * before this resolves, and a recording that failed gets one more attempt.
   */
  async closeAll(args?: { killedBy?: EKilledBy }): Promise<void> {
    const killedBy = args?.killedBy ?? EKilledBy.SessionEnd
    const entries = [...this.tracked.values()]
    for (const entry of entries) entry.service.stop(killedBy)
    await Promise.all(entries.map((entry) => within(CLOSE_GRACE_MS, entry.service.exited)))
    for (const entry of entries) entry.service.stop(killedBy)
    await Promise.all(entries.map((entry) => within(KILLED_GRACE_MS, entry.service.exited)))
    await within(KILLED_GRACE_MS, Promise.all(entries.map((entry) => entry.ending)))
    await within(KILLED_GRACE_MS, this.retryEndings({}))
    this.tracked.clear()
    this.listeners.clear()
    this.settledListeners.clear()
  }

  /**
   * Fire-and-forget — a service already running must never wait on, or die with, its own record.
   */
  private recordStart(args: {
    serviceId: string
    args: { threadId: ThreadId; command: string; description: string }
  }): void {
    if (this.journal === undefined) return
    this.recordingStarts += 1
    void this.journal
      .started({
        threadId: args.args.threadId,
        serviceId: args.serviceId,
        draft: {
          type: 'service-started',
          serviceId: args.serviceId,
          command: args.args.command,
          description: args.args.description,
          bootId,
        },
      })
      .finally(() => {
        this.recordingStarts -= 1
        if (!this.settling()) this.announceSettled()
      })
  }

  private announceExit(service: Service): void {
    const entry = this.tracked.get(service.serviceId)
    if (entry !== undefined) this.endings.exited(entry)
  }
}
