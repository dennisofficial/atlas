import { Inject, Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'
import { factorySandboxNameFor } from '../../sandboxes/sandbox-names'
import { SandboxesService } from '../../sandboxes/sandboxes.service'
import { ThreadsService } from '../../sessions/threads.service'
import { EFactoryEventKind, type TranscriptEventDto, type WorkItemDto } from '../factory.types'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { FactoryCredentialService } from './factory-credentials'
import { FactoryIdentityService } from './factory-identity'
import { ORCHESTRATOR_CHANNEL, type OrchestratorChannel } from './orchestrator-channel'
import { orchestratorInstructions, wakeMessageFor } from './orchestrator-prompt'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

type OrchestratorEndpoint = { token: string; url: string }

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

    const userId = await this.identity.userId()
    await this.credentials.ensureSeeded({ userId })
    const threadId = await this.ensureThread({ item, externalId: args.externalId, userId })
    const fresh = item.orchestratorDeliveredEventId === null
    let endpoint: OrchestratorEndpoint | null = await this.sandboxes.runningEndpoint({
      userId,
      threadId,
    })

    for (const [index, event] of pending.entries()) {
      const text =
        fresh && index === 0
          ? `${orchestratorInstructions({ workItemId: item.id, repo: item.repo, sourceKind: item.sourceKind })}\n\n---\n\n${wakeMessageFor({ event })}`
          : wakeMessageFor({ event })
      try {
        endpoint = await this.deliverEvent({ item, userId, threadId, event, text, endpoint })
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
   * Reply events record what the orchestrator itself posted; feeding them back would be its own
   * words arriving as news. The webhook echo never reaches the transcript — ingress drops it.
   */
  private async pendingEvents(item: WorkItemDto): Promise<TranscriptEventDto[]> {
    const events = (await this.transcript.list({ workItemId: item.id })).filter(
      (event) => event.kind !== EFactoryEventKind.Reply,
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

  private async deliverEvent(args: {
    item: WorkItemDto
    userId: string
    threadId: string
    event: TranscriptEventDto
    text: string
    endpoint: OrchestratorEndpoint | null
  }): Promise<OrchestratorEndpoint> {
    if (args.endpoint !== null) {
      const retried = await this.tryEndpoint({
        endpoint: args.endpoint,
        threadId: args.threadId,
        event: args.event,
        text: args.text,
      })
      if (retried) return args.endpoint
      this.logger.log(
        `cached orchestrator endpoint for work item ${args.item.id} is dead, re-attaching`,
      )
    }
    const attached = await this.attachEndpoint({
      item: args.item,
      userId: args.userId,
      threadId: args.threadId,
    })
    await this.injectEvent({
      endpoint: attached,
      threadId: args.threadId,
      event: args.event,
      text: args.text,
    })
    return attached
  }

  /**
   * One fresh-socket retry before escalating: an attach rotates the token, and the launcher reads
   * the running serve's stale-token 401 as a wedge and restarts it — so anything that might be a
   * transient socket error gets a second chance on the credential the serve actually booted with.
   */
  private async tryEndpoint(args: {
    endpoint: OrchestratorEndpoint
    threadId: string
    event: TranscriptEventDto
    text: string
  }): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.injectEvent(args)
        return true
      } catch {
        if (await this.committed({ threadId: args.threadId, marker: args.event.id })) return true
      }
    }
    return false
  }

  private async attachEndpoint(args: {
    item: WorkItemDto
    userId: string
    threadId: string
  }): Promise<OrchestratorEndpoint> {
    const attachment = await this.sandboxes.attach({
      userId: args.userId,
      threadId: args.threadId,
      name: factorySandboxNameFor({ workItemId: args.item.id }),
    })
    await this.sandboxes.whenSettled({ threadId: args.threadId })
    const status = await this.sandboxes.status({ userId: args.userId, threadId: args.threadId })
    if (status.url === undefined) {
      throw new Error(`orchestrator sandbox ${status.name} has no serve route`)
    }
    return { token: attachment.token, url: status.url }
  }

  private async injectEvent(args: {
    endpoint: OrchestratorEndpoint
    threadId: string
    event: TranscriptEventDto
    text: string
  }): Promise<void> {
    if (await this.committed({ threadId: args.threadId, marker: args.event.id })) return
    await this.channel.inject({
      url: args.endpoint.url,
      token: args.endpoint.token,
      threadId: args.threadId,
      text: args.text,
      accepted: () => this.committed({ threadId: args.threadId, marker: args.event.id }),
    })
  }

  private async committed(args: { threadId: string; marker: string }): Promise<boolean> {
    const landed = await db.event.findFirst({
      where: { threadId: args.threadId, type: 'user-said', body: { contains: args.marker } },
      select: { id: true },
    })
    return landed !== null
  }
}
