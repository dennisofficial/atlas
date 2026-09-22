import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { db } from '../../../db'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { EFactoryEventKind, type WorkItemDto } from '../factory.types'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import { OrchestratorService } from '../orchestrator/orchestrator.service'
import { GithubAppService } from '../reply/github-app.service'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { repoCoordinatesOf, ticketAliasOf } from './station-lookup'
import { parseStationResult } from './station-result'
import { parseReviewVerdict } from './station-verdict'
import {
  EReviewVerdict,
  EStationKind,
  EStationRunStatus,
  FACTORY_BRANCH_PREFIX,
  type StationResultAccepted,
} from './station.types'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * The result gate: the station reports, the control plane validates the contract and the claimed
 * push against the remote, and only then does the result land on the transcript and wake the
 * orchestrator. A refusal keeps the run open so the station can fix and resubmit.
 */
@Injectable()
export class StationResultsService {
  private readonly logger = new Logger(StationResultsService.name)

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly transcript: TranscriptService,
    private readonly sandboxes: SandboxesService,
    private readonly identity: FactoryIdentityService,
    private readonly githubApp: GithubAppService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async submitResult(args: {
    stationThreadId: string
    runId: string
    result: unknown
  }): Promise<StationResultAccepted> {
    const run = await db.factoryStationRun.findUnique({ where: { id: args.runId } })
    if (run === null) throw new NotFoundException(`unknown station run ${args.runId}`)
    if (run.threadId !== args.stationThreadId) {
      throw new ForbiddenException(`this sandbox is not station run ${args.runId}`)
    }
    const item = await this.workItems.find({ workItemId: run.workItemId })
    const alias = await ticketAliasOf({ workItems: this.workItems, item })

    if (run.status !== EStationRunStatus.Running) {
      const recorded = await db.factoryTranscriptEvent.findFirst({
        where: { surface: alias.surface, deliveryId: `station-result:${run.id}` },
        select: { id: true },
      })
      if (recorded !== null) return { recorded: true, stationRunId: run.id }
      throw new ConflictException(`station run ${run.id} is ${run.status}; it records no result`)
    }

    let result: unknown
    let requestsChanges = false
    if (run.kind === EStationKind.Reviewer) {
      const parsed = parseReviewVerdict(args.result)
      if (!parsed.ok) throw new BadRequestException(parsed.error)
      result = parsed.verdict
      requestsChanges = parsed.verdict.verdict === EReviewVerdict.RequestChanges
    } else {
      const parsed = parseStationResult(args.result)
      if (!parsed.ok) throw new BadRequestException(parsed.error)
      if (parsed.result.pushed) {
        await this.verifyPushed({ item, branch: parsed.result.branch, headSha: parsed.result.head_sha })
      }
      result = parsed.result
    }

    const appended = await this.transcript.append({
      surface: alias.surface,
      externalId: alias.externalId,
      deliveryId: `station-result:${run.id}`,
      kind: EFactoryEventKind.StationResult,
      author: 'atlas-factory',
      payload: JSON.stringify({ runId: run.id, kind: run.kind, result }),
    })
    if (appended === null) {
      throw new InternalServerErrorException(
        `station result for run ${run.id} found no aliased surface to land on`,
      )
    }
    // A duplicate delivery id returns appended:false — only a fresh verdict burns a cycle.
    if (requestsChanges && appended.appended) {
      await this.workItems.countRevision({ workItemId: item.id })
    }

    const at = new Date().toISOString()
    await db.factoryStationRun.update({
      where: { id: run.id },
      data: { status: EStationRunStatus.Finished, updatedAt: at, finishedAt: at },
    })

    const userId = await this.identity.userId()
    await this.sandboxes.stop({ userId, threadId: run.threadId }).catch((failure: unknown) => {
      this.logger.warn(`could not stop station sandbox for run ${run.id}: ${messageOf(failure)}`)
    })
    this.orchestrator.wake({ workItemId: item.id, externalId: alias.externalId })
    this.logger.log(`station run ${run.id} recorded its result for work item ${item.id}`)
    return { recorded: true, stationRunId: run.id }
  }

  private async verifyPushed(args: {
    item: WorkItemDto
    branch: string
    headSha: string
  }): Promise<void> {
    if (!args.branch.startsWith(FACTORY_BRANCH_PREFIX)) {
      throw new UnprocessableEntityException(
        `the reported branch ${args.branch} is not a factory branch (${FACTORY_BRANCH_PREFIX}*) — the result is refused`,
      )
    }
    const { owner, repo } = repoCoordinatesOf(args.item.repo)
    const head = await this.githubApp.branchHead({ owner, repo, branch: args.branch })
    if (head === null) {
      throw new UnprocessableEntityException(
        `branch ${args.branch} is not on the remote — push it, then resubmit the result`,
      )
    }
    if (head !== args.headSha) {
      throw new UnprocessableEntityException(
        `the remote head of ${args.branch} is ${head}, not the reported ${args.headSha} — push and resubmit`,
      )
    }
  }
}
