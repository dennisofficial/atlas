import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common'
import { EFactoryAliasKind, EFactoryEventKind, EFactorySurface, EFactoryWorkItemStatus } from '../factory.types'
import { GithubAppService } from '../reply/github-app.service'
import { repoCoordinatesOf, orchestratedItem } from '../stations/station-lookup'
import { parseStationResult } from '../stations/station-result'
import { parseReviewVerdict } from '../stations/station-verdict'
import {
  EReviewVerdict,
  EStationKind,
  FACTORY_BRANCH_PREFIX,
  type DeliveryResult,
} from '../stations/station.types'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'

const unprocessable = (reason: string): UnprocessableEntityException =>
  new UnprocessableEntityException(`delivery refused: ${reason}`)

/**
 * The delivery gate, in code: the orchestrator asks, the control plane re-reads the transcript and
 * the remote, and only a work item with a pushed factory branch whose head still matches, attached
 * verification evidence, and an approving reviewer gets a draft PR. Ready-for-review and merge are
 * never automated.
 */
@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name)

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly transcript: TranscriptService,
    private readonly githubApp: GithubAppService,
  ) {}

  async deliver(args: {
    orchestratorThreadId: string
    title: string
    body: string
  }): Promise<DeliveryResult> {
    const item = await orchestratedItem({ threadId: args.orchestratorThreadId })
    if (
      item.status === EFactoryWorkItemStatus.Merged ||
      item.status === EFactoryWorkItemStatus.Closed ||
      item.status === EFactoryWorkItemStatus.Stopped ||
      item.status === EFactoryWorkItemStatus.Delivered
    ) {
      throw new ConflictException(`work item ${item.id} is ${item.status}; it does not deliver`)
    }
    const aliases = await this.workItems.listAliases({ workItemId: item.id })
    const existingPr = aliases.find((alias) => alias.kind === EFactoryAliasKind.PullRequest)
    if (existingPr !== undefined) {
      throw new ConflictException(
        `work item ${item.id} already has a pull request: ${existingPr.externalId}`,
      )
    }

    const events = await this.transcript.list({ workItemId: item.id })
    const results = events
      .filter((event) => event.kind === EFactoryEventKind.StationResult)
      .map((event) => JSON.parse(event.payload) as { kind: string; result: unknown })
    const implementer = [...results].reverse().find((one) => one.kind === EStationKind.Implementer)
    const reviewer = [...results].reverse().find((one) => one.kind === EStationKind.Reviewer)

    if (implementer === undefined) throw unprocessable('no implementer result on the transcript')
    const parsedResult = parseStationResult(implementer.result)
    if (!parsedResult.ok) throw unprocessable(`the stored implementer result is unreadable: ${parsedResult.error}`)
    const result = parsedResult.result
    if (!result.pushed) throw unprocessable('the implementer pushed nothing')
    if (!result.branch.startsWith(FACTORY_BRANCH_PREFIX)) {
      throw unprocessable(`branch ${result.branch} is not factory-owned (${FACTORY_BRANCH_PREFIX}*)`)
    }
    if (result.verification.length === 0) {
      throw unprocessable('the implementer attached no verification evidence')
    }
    const { owner, repo } = repoCoordinatesOf(item.repo)
    const head = await this.githubApp.branchHead({ owner, repo, branch: result.branch })
    if (head !== result.head_sha) {
      throw unprocessable(
        head === null
          ? `branch ${result.branch} is not on the remote`
          : `the remote head of ${result.branch} is ${head}, not the implementer's ${result.head_sha}`,
      )
    }

    if (reviewer === undefined) throw unprocessable('no reviewer verdict on the transcript')
    const parsedVerdict = parseReviewVerdict(reviewer.result)
    if (!parsedVerdict.ok) throw unprocessable(`the stored reviewer verdict is unreadable: ${parsedVerdict.error}`)
    if (parsedVerdict.verdict.verdict !== EReviewVerdict.Approve) {
      throw unprocessable('the latest review requested changes')
    }

    const pr = await this.githubApp.createPullRequest({
      owner,
      repo,
      head: result.branch,
      base: result.base,
      title: args.title,
      body: args.body,
    })
    const externalId = `${item.repo}/pull/${pr.number}`
    await this.workItems.registerAlias({
      workItemId: item.id,
      surface: EFactorySurface.GitHub,
      externalId,
      kind: EFactoryAliasKind.PullRequest,
    })
    const appended = await this.transcript.append({
      surface: EFactorySurface.GitHub,
      externalId,
      deliveryId: `delivery:${item.id}`,
      kind: EFactoryEventKind.Delivery,
      author: 'atlas-factory',
      payload: JSON.stringify({
        number: pr.number,
        url: pr.url,
        branch: result.branch,
        headSha: result.head_sha,
        title: args.title,
      }),
    })
    if (appended === null) {
      this.logger.warn(`delivery event for ${externalId} found no alias immediately after registering it`)
    }
    await this.workItems.transition({ workItemId: item.id, status: EFactoryWorkItemStatus.Delivered })
    this.logger.log(`work item ${item.id} delivered as draft PR ${pr.url}`)
    return { delivered: true, number: pr.number, url: pr.url, branch: result.branch }
  }
}
