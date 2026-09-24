import { Inject, Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'
import { factorySandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ESandboxFactoryRole } from '../../platform/sandboxes/sandboxes.types'
import { ThreadsService } from '../../platform/sessions/threads.service'
import { EFactoryEventKind, type TranscriptEventDto, type WorkItemDto } from '../factory.types'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { FactoryCredentialService } from './factory-credentials'
import { FactoryIdentityService } from './factory-identity'
import { ORCHESTRATOR_CHANNEL, type OrchestratorChannel } from './orchestrator-channel'
import { orchestratorInstructions, wakeMessageFor } from './orchestrator-prompt'
import { deliverToServeThread } from './serve-delivery'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name)
  private readonly wakeChains = new Map<string, Promise<void>>()

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly transcript: TranscriptService,
    private readonly threads: ThreadsService,
    private readonly sandboxes: SandboxesService,
    private readonly identity: FactoryIdentityService,
    private readonly credentials: FactoryCredentialService,
    @Inject(ORCHESTRATOR_CHANNEL) private readonly channel: OrchestratorChannel,
  ) {}

  wake(args: { workItemId: string; externalId: string }): void {
    const previous = this.wakeChains.get(args.workItemId) ?? Promise.resolve()
    const run = previous.then(
      () => this.deliver(args),
      () => this.deliver(args),
    )
    this.wakeChains.set(args.workItemId, run)
    const cleanup = () => {
      if (this.wakeChains.get(args.workItemId) === run) this.wakeChains.delete(args.workItemId)
    }
    void run.then(cleanup, cleanup)
    void run.catch((failure: unknown) => {
      this.logger.warn(
        `orchestrator wake failed for work item ${args.workItemId}: ${messageOf(failure)}`,
      )
    })
  }

  whenSettled(args: { workItemId: string }): Promise<void> {
    return this.wakeChains.get(args.workItemId) ?? Promise.resolve()
  }

  private async deliver(args: { workItemId: string; externalId: string }): Promise<void> {
    const item = await this.workItems.find({ workItemId: args.workItemId })
    const pending = await this.pendingEvents(item)
    if (pending.length === 0) return

    const userId = await this.identity.userId({ organizationId: item.organizationId })
    await this.credentials.ensureSeeded({ userId, organizationId: item.organizationId })
    const threadId = await this.ensureThread({ item, externalId: args.externalId, userId })
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
            pinnedModel: await this.credentials.modelRef({ organizationId: item.organizationId }),
            factoryRole: ESandboxFactoryRole.Orchestrator,
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
    const own: readonly string[] = [
      EFactoryEventKind.Reply,
      EFactoryEventKind.StationRequest,
      EFactoryEventKind.Delivery,
    ]
    const events = (await this.transcript.list({ workItemId: item.id })).filter(
      (event) => !own.includes(event.kind),
    )
    const watermark = item.orchestratorDeliveredEventId
    if (watermark === null) return events
    const index = events.findIndex((event) => event.id === watermark)
    return index === -1 ? events : events.slice(index + 1)
  }

  private async ensureThread(args: {
    item: WorkItemDto
    externalId: string
    userId: string
  }): Promise<string> {
    if (args.item.orchestratorThreadId !== null) return args.item.orchestratorThreadId
    const thread = await this.threads.create({
      userId: args.userId,
      draft: { title: `factory: ${args.externalId}`, repo: args.item.repo },
    })
    const claim = await this.workItems.claimOrchestrator({
      workItemId: args.item.id,
      threadId: thread.id,
    })
    if (!claim.claimed) {
      await db.thread.delete({ where: { id: thread.id } }).catch((failure: unknown) => {
        this.logger.warn(`could not delete orphaned thread ${thread.id}: ${messageOf(failure)}`)
      })
    }
    return claim.threadId
  }
}
