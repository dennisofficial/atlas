import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { db } from '../../../db'
import { factorySandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ESandboxDriveMode, ESandboxFactoryRole } from '../../platform/sandboxes/sandboxes.types'
import { ThreadsService } from '../../platform/sessions/threads.service'
import { FactoryDrivesService } from '../drives/drives.service'
import type { TranscriptEventDto, WorkItemDto } from '../factory.types'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { FactoryCredentialService } from './factory-credentials'
import { FactoryIdentityService } from './factory-identity'
import { ORCHESTRATOR_CHANNEL, type OrchestratorChannel } from './orchestrator-channel'
import { orchestratorInstructions, wakeMessageFor } from './orchestrator-prompt'
import { deliverToServeThread } from './serve-delivery'
import { undeliveredEventsOf, WakeRecoveryService } from './wake-recovery'
import { WakeLockService } from './wake-lock'
import { enqueueWake } from './wake-outbox'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name)

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly transcript: TranscriptService,
    private readonly threads: ThreadsService,
    private readonly sandboxes: SandboxesService,
    private readonly identity: FactoryIdentityService,
    private readonly credentials: FactoryCredentialService,
    private readonly drives: FactoryDrivesService,
    private readonly wakeLock: WakeLockService,
    private readonly wakeRecovery: WakeRecoveryService,
    @Inject(ORCHESTRATOR_CHANNEL) private readonly channel: OrchestratorChannel,
  ) {}

  onModuleInit(): void {
    this.wakeRecovery.registerDriver(this)
  }

  /**
   * A wake is a durable outbox row first and a drive second: the enqueue is the caller's only
   * guarantee, so a process killed after the transcript commit still has the wake recorded, and
   * the boot recovery (or this drain) drives it later. A failed drive leaves the row enqueued.
   */
  wake(args: { workItemId: string; externalId: string; repo?: string }): void {
    void enqueueWake(args)
      .then(() => this.wakeRecovery.drainOutbox())
      .catch((failure: unknown) => {
        this.logger.warn(
          `orchestrator wake failed for work item ${args.workItemId}: ${messageOf(failure)}`,
        )
      })
  }

  /** Specs and the boot path drive directly; webhook callers go through `wake`. */
  async wakeNow(args: { workItemId: string; externalId: string; repo?: string }): Promise<void> {
    await enqueueWake(args)
    await this.wakeRecovery.drainOutbox()
  }

  /**
   * The single drive entry for a wake, taken by the webhook path and by the boot recovery scan
   * alike. The advisory lock makes it correct across replicas: during a rolling deploy both the
   * old and new containers may try, and only the lock holder drives while the other skips. The
   * watermark makes a re-drive idempotent, so a wake abandoned by a restart is simply run again.
   */
  async runWake(args: { workItemId: string; externalId: string; repo?: string }): Promise<void> {
    await this.wakeLock.runExclusive({
      workItemId: args.workItemId,
      drive: () => this.deliver(args),
    })
  }

  private async deliver(args: {
    workItemId: string
    externalId: string
    repo?: string
  }): Promise<void> {
    const item = await this.workItems.find({ workItemId: args.workItemId })
    const pending = await this.pendingEvents(item)
    if (pending.length === 0) return

    const userId = await this.identity.userId({ organizationId: item.organizationId })
    await this.credentials.ensureSeeded({ userId, organizationId: item.organizationId })
    const threadId = await this.ensureThread({
      item,
      externalId: args.externalId,
      userId,
      repo: args.repo ?? item.repo,
    })
    const driveName = await this.drives.ensure({ workItemId: item.id })
    const fresh = item.orchestratorDeliveredEventId === null

    for (const [index, event] of pending.entries()) {
      const text =
        fresh && index === 0
          ? `${orchestratorInstructions({ workItemId: item.id, repo: item.repo, sourceKind: item.sourceKind })}\n\n---\n\n${wakeMessageFor({ event })}`
          : wakeMessageFor({ event })
      try {
        await deliverToServeThread({
          deps: { sandboxes: this.sandboxes, channel: this.channel },
          userId,
          threadId,
          sandboxName: factorySandboxNameFor({ workItemId: item.id }),
          text,
          marker: event.id,
          extras: {
            drive: { name: driveName, mode: ESandboxDriveMode.Snapshot },
            pinnedModel: await this.credentials.modelRef({ organizationId: item.organizationId }),
            factoryRole: ESandboxFactoryRole.Orchestrator,
            decisionsUrl: await this.credentials.decisionsUrl({
              organizationId: item.organizationId,
            }),
          },
        })
      } catch (failure) {
        this.logger.warn(
          `orchestrator delivery failed for work item ${item.id}, event ${event.id} (delivery ${event.deliveryId}): ${messageOf(failure)}`,
        )
        throw failure
      }
      await this.workItems.markOrchestratorDelivered({ workItemId: item.id, eventId: event.id })
    }
  }

  /**
   * Reply, station-request, and delivery events record what the orchestrator itself did; feeding
   * them back would be its own words arriving as news. The webhook echo of a reply never reaches
   * the transcript — ingress drops it.
   */
  private async pendingEvents(item: WorkItemDto): Promise<TranscriptEventDto[]> {
    const events = await this.transcript.list({ workItemId: item.id })
    return undeliveredEventsOf({ events, watermark: item.orchestratorDeliveredEventId })
  }

  /**
   * A first wake that fails after creating its thread leaves the work item unclaimed, so a retry
   * (or a recovery re-drive) adopts that thread rather than leak a second one. The thread's title
   * is deterministic (`factory: <externalId>`), so the orphan is found by it before creating anew.
   */
  private async ensureThread(args: {
    item: WorkItemDto
    externalId: string
    userId: string
    repo: string
  }): Promise<string> {
    if (args.item.orchestratorThreadId !== null) return args.item.orchestratorThreadId
    const title = `factory: ${args.externalId}`
    const prior = await db.thread.findFirst({
      where: { userId: args.userId, title },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    const threadId =
      prior?.id ??
      (await this.threads.create({ userId: args.userId, draft: { title, repo: args.item.repo } }))
        .id
    const claim = await this.workItems.claimOrchestrator({
      workItemId: args.item.id,
      threadId,
    })
    if (!claim.claimed && prior === null) {
      await db.thread.delete({ where: { id: threadId } }).catch((failure: unknown) => {
        this.logger.warn(`could not delete orphaned thread ${threadId}: ${messageOf(failure)}`)
      })
    }
    return claim.threadId
  }
}
