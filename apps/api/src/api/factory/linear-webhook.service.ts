import { Injectable, Logger } from '@nestjs/common'
import { FactoryConnectionsService } from './connections/connections.service'
import { FactoryDrivesService } from './drives/drives.service'
import {
  EFactoryAliasKind,
  EFactoryConnectionProvider,
  EFactoryEventKind,
  EFactorySurface,
  EFactoryWorkItemStatus,
} from './factory.types'
import { getIssue } from './linear/linear-client'
import { LinearTokensService } from './linear/linear-tokens.service'
import type {
  LinearAgentSessionEventPayload,
  LinearCommentEventPayload,
  LinearIssueEventPayload,
  LinearPayloadBase,
  LinearWebhookOutcome,
} from './linear-webhook.types'
import { OrchestratorService } from './orchestrator/orchestrator.service'
import { ReplyWatchService } from './reply-watch/reply-watch.service'
import { StationsService } from './stations/stations.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

const NOT_HANDLED: LinearWebhookOutcome = { handled: false }
const DONE_STATE_TYPES = new Set(['completed', 'canceled'])

@Injectable()
export class LinearWebhookService {
  private readonly logger = new Logger(LinearWebhookService.name)

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly connections: FactoryConnectionsService,
    private readonly transcript: TranscriptService,
    private readonly orchestrator: OrchestratorService,
    private readonly drives: FactoryDrivesService,
    private readonly stations: StationsService,
    private readonly linearTokens: LinearTokensService,
    private readonly replyWatch: ReplyWatchService,
  ) {}

  async handle(args: { deliveryId: string; payload: unknown }): Promise<LinearWebhookOutcome> {
    const base = args.payload as Partial<LinearPayloadBase>
    const organizationId = await this.resolveOrganizationId({
      workspaceId: base.organizationId,
    })
    if (organizationId === null) return NOT_HANDLED

    switch (base.type) {
      case 'AgentSessionEvent':
        return this.handleAgentSession({
          deliveryId: args.deliveryId,
          payload: args.payload as LinearAgentSessionEventPayload,
          organizationId,
        })
      case 'Issue':
        return this.handleIssue({
          deliveryId: args.deliveryId,
          payload: args.payload as LinearIssueEventPayload,
        })
      case 'Comment':
        return this.handleComment({
          deliveryId: args.deliveryId,
          payload: args.payload as LinearCommentEventPayload,
          organizationId,
        })
      default:
        this.logger.log(`ignored unsupported linear event type: ${String(base.type)}`)
        return NOT_HANDLED
    }
  }

  // Unlike the github half there is no default-organization fallback: a workspace with no
  // connection row never got here through our install flow, so the delivery is dropped.
  private async resolveOrganizationId(args: {
    workspaceId: string | undefined
  }): Promise<string | null> {
    if (args.workspaceId === undefined) {
      this.logger.warn('linear webhook payload carried no organizationId; dropping the delivery')
      return null
    }
    const connection = await this.connections.resolve({
      provider: EFactoryConnectionProvider.Linear,
      externalAccountId: args.workspaceId,
    })
    if (connection === null) {
      this.logger.warn(
        `no factory connection for linear workspace ${args.workspaceId}; dropping the delivery`,
      )
      return null
    }
    return connection.organizationId
  }

  private async handleAgentSession(args: {
    deliveryId: string
    payload: LinearAgentSessionEventPayload
    organizationId: string
  }): Promise<LinearWebhookOutcome> {
    const { payload } = args
    const issue = payload.agentSession.issue
    if (issue === undefined) {
      this.logger.log(`dropped linear agent session ${payload.agentSession.id} with no issue`)
      return NOT_HANDLED
    }

    if (payload.action === 'created') {
      const { created } = await this.workItems.intake({
        organizationId: args.organizationId,
        repo: issue.identifier,
        sourceKind: EFactorySurface.Linear,
        surface: EFactorySurface.Linear,
        externalId: issue.id,
        aliasKind: EFactoryAliasKind.Issue,
      })
      return this.append({
        externalId: issue.id,
        deliveryId: args.deliveryId,
        kind: created ? EFactoryEventKind.Intake : EFactoryEventKind.StatusChange,
        author: payload.agentSession.creator?.name,
        payload,
      })
    }

    if (payload.action === 'prompted') {
      return this.append({
        externalId: issue.id,
        deliveryId: args.deliveryId,
        kind: EFactoryEventKind.Comment,
        author: payload.agentActivity?.user?.name,
        payload,
      })
    }

    this.logger.log(`ignored linear agent session action: ${payload.action}`)
    return NOT_HANDLED
  }

  private async handleIssue(args: {
    deliveryId: string
    payload: LinearIssueEventPayload
  }): Promise<LinearWebhookOutcome> {
    const { payload } = args
    const stateType = payload.data.state?.type

    if (payload.action === 'update' && stateType !== undefined && DONE_STATE_TYPES.has(stateType)) {
      const outcome = await this.append({
        externalId: payload.data.id,
        deliveryId: args.deliveryId,
        kind: EFactoryEventKind.StatusChange,
        author: payload.actor?.name,
        payload,
        deferWake: true,
      })
      if (outcome.workItemId !== undefined && outcome.appended === true) {
        await this.workItems.transition({
          workItemId: outcome.workItemId,
          status: EFactoryWorkItemStatus.Closed,
        })
        await this.stations.stopRunningFor({ workItemId: outcome.workItemId })
        await this.drives.release({ workItemId: outcome.workItemId })
        this.orchestrator.wake({ workItemId: outcome.workItemId, externalId: payload.data.id })
      }
      return outcome
    }

    return this.append({
      externalId: payload.data.id,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.StatusChange,
      author: payload.actor?.name,
      payload,
    })
  }

  private async handleComment(args: {
    deliveryId: string
    payload: LinearCommentEventPayload
    organizationId: string
  }): Promise<LinearWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'create' || payload.data.issueId === undefined) return NOT_HANDLED

    const outcome = await this.append({
      externalId: payload.data.issueId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Comment,
      author: payload.actor?.name,
      payload,
    })
    if (outcome.handled) {
      if (outcome.appended === true && outcome.workItemId !== undefined) {
        this.replyWatch.watch({
          workItemId: outcome.workItemId,
          eventId: args.deliveryId,
          ref: {
            surface: EFactorySurface.Linear,
            organizationId: args.organizationId,
            externalId: payload.data.issueId,
            commentId: payload.data.id,
          },
        })
      }
      return outcome
    }
    return this.intakeMentionedComment({
      deliveryId: args.deliveryId,
      payload,
      organizationId: args.organizationId,
    })
  }

  // Work-item creation is the only gated act at intake, and the key is an explicit mention —
  // a noise gate, not a trust one. A comment on a linked surface always flows; on an unlinked
  // surface only a mention intakes, from anyone. Linear renders mentions as the display name
  // (@atlas) rather than a stable handle, so the needle is deliberately fuzzy: a false positive
  // costs one orchestrator wake, a false negative loses the ask.
  private async intakeMentionedComment(args: {
    deliveryId: string
    payload: LinearCommentEventPayload
    organizationId: string
  }): Promise<LinearWebhookOutcome> {
    const { payload } = args
    const issueId = payload.data.issueId
    if (issueId === undefined) return NOT_HANDLED
    if (!this.mentionsAgent({ body: payload.data.body })) return NOT_HANDLED

    const { created } = await this.workItems.intake({
      organizationId: args.organizationId,
      repo: await this.issueLabel({ issueId, organizationId: args.organizationId }),
      sourceKind: EFactorySurface.Linear,
      surface: EFactorySurface.Linear,
      externalId: issueId,
      aliasKind: EFactoryAliasKind.Issue,
    })
    return this.append({
      externalId: issueId,
      deliveryId: args.deliveryId,
      kind: created ? EFactoryEventKind.Intake : EFactoryEventKind.Comment,
      author: payload.actor?.name,
      payload,
    })
  }

  // The comment payload carries no identifier; the label is cosmetic (the alias is the routing
  // key), so a failed lookup degrades to the raw issue id rather than refusing the intake.
  private async issueLabel(args: { issueId: string; organizationId: string }): Promise<string> {
    try {
      const connections = await this.connections.listForOrganization({
        organizationId: args.organizationId,
      })
      const linear = connections.find((one) => one.provider === EFactoryConnectionProvider.Linear)
      if (linear === undefined) return args.issueId
      const token = await this.linearTokens.getToken({ workspaceId: linear.externalAccountId })
      return (await getIssue({ token, issueId: args.issueId })).identifier
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure)
      this.logger.warn(`could not resolve the linear issue identifier for ${args.issueId}: ${detail}`)
      return args.issueId
    }
  }

  private mentionsAgent(args: { body: string }): boolean {
    return /@atlas(?![a-z0-9-])/i.test(args.body)
  }

  private async append(args: {
    externalId: string
    deliveryId: string
    kind: EFactoryEventKind
    author: string | undefined
    payload: unknown
    deferWake?: boolean
  }): Promise<LinearWebhookOutcome> {
    const result = await this.transcript.append({
      surface: EFactorySurface.Linear,
      externalId: args.externalId,
      deliveryId: args.deliveryId,
      kind: args.kind,
      author: args.author,
      payload: JSON.stringify(args.payload),
    })
    if (result === null) {
      this.logger.log(`dropped linear event for untracked surface: ${args.externalId}`)
      return NOT_HANDLED
    }
    if (result.appended && args.deferWake !== true) {
      this.orchestrator.wake({
        workItemId: result.workItemId,
        externalId: args.externalId,
      })
    }
    return { handled: true, workItemId: result.workItemId, kind: args.kind, appended: result.appended }
  }
}
