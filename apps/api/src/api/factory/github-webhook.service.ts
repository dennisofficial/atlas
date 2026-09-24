import { Injectable, Logger } from '@nestjs/common'
import { FactoryConnectionsService } from './connections/connections.service'
import {
  DEFAULT_ORGANIZATION_ID,
  EFactoryAliasKind,
  EFactoryConnectionProvider,
  EFactoryEventKind,
  EFactorySurface,
  EFactoryWorkItemStatus,
} from './factory.types'
import type {
  GithubIssueCommentEventPayload,
  GithubIssuesEventPayload,
  GithubPullRequestEventPayload,
  GithubPullRequestReviewCommentEventPayload,
  GithubPullRequestReviewEventPayload,
  GithubWebhookOutcome,
} from './github-webhook.types'
import { FactoryDrivesService } from './drives/drives.service'
import { OrchestratorService } from './orchestrator/orchestrator.service'
import { GithubAppService } from './reply/github-app.service'
import { StationsService } from './stations/stations.service'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

const FACTORY_LABEL = 'atlas-factory'
const NOT_HANDLED: GithubWebhookOutcome = { handled: false }

function issueExternalId(args: { repo: string; issueNumber: number }): string {
  return `${args.repo}#${args.issueNumber}`
}

function pullRequestExternalId(args: { repo: string; pullNumber: number }): string {
  return `${args.repo}/pull/${args.pullNumber}`
}

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name)

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly connections: FactoryConnectionsService,
    private readonly transcript: TranscriptService,
    private readonly orchestrator: OrchestratorService,
    private readonly githubApp: GithubAppService,
    private readonly drives: FactoryDrivesService,
    private readonly stations: StationsService,
  ) {}

  /**
   * The factory's own replies arrive back over the webhook as comments authored by the app bot.
   * They are already on the transcript (recorded at post time), so the echo is dropped here —
   * feeding it back would wake the orchestrator to read its own words and invite a reply loop.
   * The payload's performed_via_github_app id is the offline check; the bot-login lookup (which
   * fails open on a network error) is the fallback for deliveries that lack it.
   */
  private async isOwnEcho(args: {
    login: string
    viaAppId: number | undefined
  }): Promise<boolean> {
    if (this.githubApp.ownsAppId(args.viaAppId)) return true
    const bot = await this.githubApp.botLogin()
    if (bot === null) return false
    return args.login.toLowerCase() === bot
  }

  async handle(args: { event: string; deliveryId: string; payload: unknown }): Promise<GithubWebhookOutcome> {
    switch (args.event) {
      case 'ping':
        return { handled: true }
      case 'issues': {
        const payload = args.payload as GithubIssuesEventPayload
        const organizationId = await this.resolveOrganizationId({
          installationId: payload.installation?.id,
        })
        return this.handleIssues({
          deliveryId: args.deliveryId,
          payload,
          organizationId,
        })
      }
      case 'issue_comment':
        return this.handleIssueComment({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubIssueCommentEventPayload,
        })
      case 'pull_request_review':
        return this.handlePullRequestReview({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubPullRequestReviewEventPayload,
        })
      case 'pull_request_review_comment':
        return this.handlePullRequestReviewComment({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubPullRequestReviewCommentEventPayload,
        })
      case 'pull_request':
        return this.handlePullRequest({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubPullRequestEventPayload,
        })
      default:
        this.logger.log(`ignored unsupported github event: ${args.event}`)
        return NOT_HANDLED
    }
  }

  // Transition behavior: until the existing atlas-by-dl installations get connection rows,
  // an unresolved installation keeps landing in the default organization. Linear gets no fallback.
  private async resolveOrganizationId(args: {
    installationId: number | undefined
  }): Promise<string> {
    if (args.installationId === undefined) {
      this.logger.warn('github webhook payload carried no installation id; using the default organization')
      return DEFAULT_ORGANIZATION_ID
    }
    const connection = await this.connections.resolve({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: String(args.installationId),
    })
    if (connection === null) {
      this.logger.warn(
        `no factory connection for github installation ${args.installationId}; using the default organization`,
      )
      return DEFAULT_ORGANIZATION_ID
    }
    return connection.organizationId
  }

  private async handleIssues(args: {
    deliveryId: string
    payload: GithubIssuesEventPayload
    organizationId: string
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    const externalId = issueExternalId({ repo: payload.repository.full_name, issueNumber: payload.issue.number })

    if (payload.action === 'closed') {
      const outcome = await this.append({
        externalId,
        deliveryId: args.deliveryId,
        kind: EFactoryEventKind.StatusChange,
        author: payload.sender.login,
        payload,
        deferWake: true,
      })
      if (outcome.workItemId !== undefined && outcome.appended === true) {
        await this.workItems.transition({ workItemId: outcome.workItemId, status: EFactoryWorkItemStatus.Closed })
        await this.stations.stopRunningFor({ workItemId: outcome.workItemId })
        await this.drives.release({ workItemId: outcome.workItemId })
        this.orchestrator.wake({ workItemId: outcome.workItemId, externalId })
      }
      return outcome
    }

    if (payload.action === 'reopened') {
      const outcome = await this.append({
        externalId,
        deliveryId: args.deliveryId,
        kind: EFactoryEventKind.StatusChange,
        author: payload.sender.login,
        payload,
        deferWake: true,
      })
      if (outcome.workItemId !== undefined && outcome.appended === true) {
        const item = await this.workItems.find({ workItemId: outcome.workItemId })
        if (item.status === EFactoryWorkItemStatus.Closed) {
          await this.workItems.transition({ workItemId: item.id, status: EFactoryWorkItemStatus.Active })
        }
        this.orchestrator.wake({ workItemId: outcome.workItemId, externalId })
      }
      return outcome
    }

    if (payload.action === 'labeled' && payload.label?.name === FACTORY_LABEL) {
      const { created } = await this.workItems.intake({
        organizationId: args.organizationId,
        repo: payload.repository.full_name,
        sourceKind: EFactorySurface.GitHub,
        surface: EFactorySurface.GitHub,
        externalId,
        aliasKind: EFactoryAliasKind.Issue,
      })
      await this.acknowledgeIntake({ payload })
      return this.append({
        externalId,
        deliveryId: args.deliveryId,
        kind: created ? EFactoryEventKind.Intake : EFactoryEventKind.StatusChange,
        author: payload.sender.login,
        payload,
      })
    }

    return this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.StatusChange,
      author: payload.sender.login,
      payload,
    })
  }

  private async acknowledgeIntake(args: {
    payload: Pick<GithubIssuesEventPayload, 'installation' | 'repository' | 'issue'>
  }): Promise<void> {
    const installationId = args.payload.installation?.id
    if (installationId === undefined) return
    try {
      await this.githubApp.addIssueReaction({
        installationId,
        repoFullName: args.payload.repository.full_name,
        issueNumber: args.payload.issue.number,
      })
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure)
      this.logger.warn(
        `could not add the intake reaction on ${args.payload.repository.full_name}#${args.payload.issue.number}: ${detail}`,
      )
    }
  }

  private async handleIssueComment(args: {
    deliveryId: string
    payload: GithubIssueCommentEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'created') return NOT_HANDLED
    const viaAppId = payload.comment.performed_via_github_app?.id
    if (await this.isOwnEcho({ login: payload.sender.login, viaAppId })) {
      this.logger.log(`dropped the factory's own comment echo on ${payload.repository.full_name}#${payload.issue.number}`)
      return NOT_HANDLED
    }

    const externalId =
      payload.issue.pull_request === undefined
        ? issueExternalId({ repo: payload.repository.full_name, issueNumber: payload.issue.number })
        : pullRequestExternalId({ repo: payload.repository.full_name, pullNumber: payload.issue.number })
    const outcome = await this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Comment,
      author: payload.sender.login,
      authorAssociation: payload.comment.author_association,
      payload,
    })
    if (outcome.handled) return outcome
    return this.intakeMentionedComment({ deliveryId: args.deliveryId, payload, externalId })
  }

  private async intakeMentionedComment(args: {
    deliveryId: string
    payload: GithubIssueCommentEventPayload
    externalId: string
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    const needle = await this.mentionNeedle()
    const mentioned =
      needle !== null && new RegExp(`${needle}(?![a-z0-9-])`).test(payload.comment.body.toLowerCase())
    if (!mentioned) return NOT_HANDLED

    const organizationId = await this.resolveOrganizationId({ installationId: payload.installation?.id })
    await this.workItems.intake({
      organizationId,
      repo: payload.repository.full_name,
      sourceKind: EFactorySurface.GitHub,
      surface: EFactorySurface.GitHub,
      externalId: args.externalId,
      aliasKind: payload.issue.pull_request === undefined ? EFactoryAliasKind.Issue : EFactoryAliasKind.PullRequest,
    })
    await this.acknowledgeIntake({ payload })
    return this.append({
      externalId: args.externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Intake,
      author: payload.sender.login,
      authorAssociation: payload.comment.author_association,
      payload,
    })
  }

  // Humans type @<slug>; only autocomplete produces @<slug>[bot]. The boundary keeps
  // @atlas-by-dlish from matching, and the [bot] form matches through the '['.
  private async mentionNeedle(): Promise<string | null> {
    try {
      const slug = await this.githubApp.appSlug()
      return `@${slug.toLowerCase()}`
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure)
      this.logger.warn(`could not resolve the factory app slug for mention detection: ${detail}`)
      return null
    }
  }

  private async handlePullRequestReview(args: {
    deliveryId: string
    payload: GithubPullRequestReviewEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'submitted') return NOT_HANDLED

    const externalId = pullRequestExternalId({
      repo: payload.repository.full_name,
      pullNumber: payload.pull_request.number,
    })
    return this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Review,
      author: payload.sender.login,
      authorAssociation: payload.review.author_association,
      payload,
    })
  }

  private async handlePullRequestReviewComment(args: {
    deliveryId: string
    payload: GithubPullRequestReviewCommentEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'created') return NOT_HANDLED

    const externalId = pullRequestExternalId({
      repo: payload.repository.full_name,
      pullNumber: payload.pull_request.number,
    })
    return this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Review,
      author: payload.sender.login,
      authorAssociation: payload.comment.author_association,
      payload,
    })
  }

  private async handlePullRequest(args: {
    deliveryId: string
    payload: GithubPullRequestEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'closed' || !payload.pull_request.merged) return NOT_HANDLED

    const externalId = pullRequestExternalId({
      repo: payload.repository.full_name,
      pullNumber: payload.pull_request.number,
    })
    const outcome = await this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Merged,
      author: payload.sender.login,
      payload,
      deferWake: true,
    })
    if (outcome.workItemId !== undefined && outcome.appended === true) {
      await this.workItems.transition({ workItemId: outcome.workItemId, status: EFactoryWorkItemStatus.Merged })
      await this.stations.stopRunningFor({ workItemId: outcome.workItemId })
      await this.drives.release({ workItemId: outcome.workItemId })
      this.orchestrator.wake({ workItemId: outcome.workItemId, externalId })
    }
    return outcome
  }

  private async append(args: {
    externalId: string
    deliveryId: string
    kind: EFactoryEventKind
    author: string
    payload: unknown
    authorAssociation?: string
    deferWake?: boolean
  }): Promise<GithubWebhookOutcome> {
    const result = await this.transcript.append({
      surface: EFactorySurface.GitHub,
      externalId: args.externalId,
      deliveryId: args.deliveryId,
      kind: args.kind,
      author: args.author,
      authorAssociation: args.authorAssociation?.toLowerCase(),
      payload: JSON.stringify(args.payload),
    })
    if (result === null) {
      this.logger.log(`dropped github event for untracked surface: ${args.externalId}`)
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
