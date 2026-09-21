import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { db } from '../../../db'
import { factoryStationSandboxNameFor } from '../../sandboxes/sandbox-names'
import { ESandboxDriveMode } from '../../sandboxes/sandboxes.types'
import { SandboxesService } from '../../sandboxes/sandboxes.service'
import { ThreadsService } from '../../sessions/threads.service'
import { FactoryDrivesService } from '../drives/drives.service'
import {
  EFactoryAliasKind,
  EFactoryEventKind,
  EFactoryWorkItemStatus,
  type WorkItemDto,
} from '../factory.types'
import { nextStationRunId, nowIso } from '../ids'
import { FactoryCredentialService } from '../orchestrator/factory-credentials'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import {
  ORCHESTRATOR_CHANNEL,
  type OrchestratorChannel,
} from '../orchestrator/orchestrator-channel'
import { OrchestratorService } from '../orchestrator/orchestrator.service'
import { deliverToServeThread, injectIntoServeThread } from '../orchestrator/serve-delivery'
import { GithubAppService } from '../reply/github-app.service'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { stationSpawnMessageFor } from './station-prompt'
import { parseStationResult } from './station-result'
import {
  EStationKind,
  EStationRunStatus,
  FACTORY_BRANCH_PREFIX,
  type StationGitToken,
  type StationResultAccepted,
  type StationSpawnResult,
} from './station.types'

const GIT_TOKEN_EXPIRY_SECONDS = 3600
const MESSAGE_CAP = 60_000

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const repoCoordinatesOf = (repo: string): { owner: string; repo: string } => {
  const [owner, name] = repo.split('/')
  if (owner === undefined || name === undefined || owner.length === 0 || name.length === 0) {
    throw new UnprocessableEntityException(`work item repo ${repo} is not owner/repo`)
  }
  return { owner, repo: name }
}

type StationRunRow = {
  id: string
  workItemId: string
  kind: string
  threadId: string
  status: string
}

/**
 * Station mechanics, spec option B: the orchestrator calls in with its sandbox token, validation
 * happens here in deterministic code, and the Vercel SDK stays exclusively in the control plane.
 */
@Injectable()
export class StationsService {
  private readonly logger = new Logger(StationsService.name)

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly transcript: TranscriptService,
    private readonly threads: ThreadsService,
    private readonly sandboxes: SandboxesService,
    private readonly identity: FactoryIdentityService,
    private readonly credentials: FactoryCredentialService,
    private readonly drives: FactoryDrivesService,
    private readonly githubApp: GithubAppService,
    private readonly orchestrator: OrchestratorService,
    @Inject(ORCHESTRATOR_CHANNEL) private readonly channel: OrchestratorChannel,
  ) {}

  async spawn(args: {
    orchestratorThreadId: string
    kind: string
    message: string
  }): Promise<StationSpawnResult> {
    const item = await this.orchestratedItem({ threadId: args.orchestratorThreadId })
    if (args.kind !== EStationKind.Implementer) {
      throw new BadRequestException(`unknown station kind ${args.kind}`)
    }
    if (
      item.status === EFactoryWorkItemStatus.Merged ||
      item.status === EFactoryWorkItemStatus.Closed ||
      item.status === EFactoryWorkItemStatus.Stopped
    ) {
      throw new ConflictException(`work item ${item.id} is ${item.status}; no stations run on it`)
    }
    const holdingDrive = await db.factoryStationRun.findFirst({
      where: {
        workItemId: item.id,
        status: EStationRunStatus.Running,
        driveMode: ESandboxDriveMode.ReadWrite,
      },
      select: { id: true },
    })
    if (holdingDrive !== null) {
      throw new ConflictException(
        `station run ${holdingDrive.id} still holds this work item's drive — stop it or let it finish first`,
      )
    }
    if (args.message.length > MESSAGE_CAP) {
      throw new BadRequestException(`the spawn message is over the ${MESSAGE_CAP} character cap`)
    }

    const userId = await this.identity.userId()
    await this.credentials.ensureSeeded({ userId })
    const driveName = await this.drives.ensure({ workItemId: item.id })

    const runId = nextStationRunId()
    const thread = await this.threads.create({
      userId,
      draft: { title: `factory ${args.kind}: ${item.repo}`, repo: item.repo },
    })
    const at = nowIso()
    await db.factoryStationRun.create({
      data: {
        id: runId,
        workItemId: item.id,
        kind: args.kind,
        threadId: thread.id,
        status: EStationRunStatus.Running,
        driveMode: ESandboxDriveMode.ReadWrite,
        createdAt: at,
        updatedAt: at,
        finishedAt: null,
      },
    })
    if (item.status === EFactoryWorkItemStatus.Intake) {
      await this.workItems.transition({
        workItemId: item.id,
        status: EFactoryWorkItemStatus.Active,
      })
    }

    await this.sandboxes.attach({
      userId,
      threadId: thread.id,
      name: factoryStationSandboxNameFor({ runId }),
      workspace: {
        remoteUrl: `https://github.com/${item.repo}.git`,
        branch: null,
        commit: null,
        patch: '',
      },
      drive: { name: driveName, mode: ESandboxDriveMode.ReadWrite },
      pinnedModel: this.credentials.modelRef(),
    })

    const alias = await this.ticketAliasOf(item)
    await this.transcript.append({
      surface: alias.surface,
      externalId: alias.externalId,
      deliveryId: `station-request:${runId}`,
      kind: EFactoryEventKind.StationRequest,
      author: 'atlas-factory',
      payload: JSON.stringify({ runId, kind: args.kind, message: args.message }),
    })

    const text = stationSpawnMessageFor({
      workItemId: item.id,
      runId,
      repo: item.repo,
      message: args.message,
    })
    void this.injectSpawn({ userId, threadId: thread.id, runId, text }).catch(
      async (failure: unknown) => {
        this.logger.warn(`station run ${runId} could not be given its spawn message: ${messageOf(failure)}`)
        await this.markRun({ runId, status: EStationRunStatus.Failed })
      },
    )

    this.logger.log(`station run ${runId} (${args.kind}) spawned for work item ${item.id}`)
    return { stationRunId: runId, threadId: thread.id, status: EStationRunStatus.Running }
  }

  async steer(args: {
    orchestratorThreadId: string
    runId: string
    message: string
  }): Promise<{ steered: true }> {
    const item = await this.orchestratedItem({ threadId: args.orchestratorThreadId })
    const run = await this.runningRunOf({ item, runId: args.runId })
    const marker = `steer:${randomUUID()}`
    await deliverToServeThread({
      deps: { sandboxes: this.sandboxes, channel: this.channel },
      userId: await this.identity.userId(),
      threadId: run.threadId,
      sandboxName: factoryStationSandboxNameFor({ runId: run.id }),
      text: `[station steer] ${marker}\n\n${args.message}`,
      marker,
    })
    return { steered: true }
  }

  async stop(args: { orchestratorThreadId: string; runId: string }): Promise<{ stopped: true }> {
    const item = await this.orchestratedItem({ threadId: args.orchestratorThreadId })
    const run = await this.runningRunOf({ item, runId: args.runId })
    await this.sandboxes.stop({ userId: await this.identity.userId(), threadId: run.threadId })
    await this.markRun({ runId: run.id, status: EStationRunStatus.Stopped })
    return { stopped: true }
  }

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
    if (run.status !== EStationRunStatus.Running) {
      const recorded = await db.factoryTranscriptEvent.findFirst({
        where: { surface: 'github', deliveryId: `station-result:${run.id}` },
        select: { id: true },
      })
      if (recorded !== null) return { recorded: true, stationRunId: run.id }
      throw new ConflictException(`station run ${run.id} is ${run.status}; it records no result`)
    }

    const parsed = parseStationResult(args.result)
    if (!parsed.ok) throw new BadRequestException(parsed.error)
    const result = parsed.result

    const item = await this.workItems.find({ workItemId: run.workItemId })
    if (result.pushed) await this.verifyPushed({ item, branch: result.branch, headSha: result.head_sha })

    const alias = await this.ticketAliasOf(item)
    await this.transcript.append({
      surface: alias.surface,
      externalId: alias.externalId,
      deliveryId: `station-result:${run.id}`,
      kind: EFactoryEventKind.StationResult,
      author: 'atlas-factory',
      payload: JSON.stringify({ runId: run.id, kind: run.kind, result }),
    })
    await this.markRun({ runId: run.id, status: EStationRunStatus.Finished })

    const userId = await this.identity.userId()
    await this.sandboxes.stop({ userId, threadId: run.threadId }).catch((failure: unknown) => {
      this.logger.warn(`could not stop station sandbox for run ${run.id}: ${messageOf(failure)}`)
    })
    this.orchestrator.wake({ workItemId: item.id, externalId: alias.externalId })
    this.logger.log(`station run ${run.id} recorded its result for work item ${item.id}`)
    return { recorded: true, stationRunId: run.id }
  }

  async mintGitToken(args: {
    stationThreadId: string
    branch: string
  }): Promise<StationGitToken> {
    const run = await db.factoryStationRun.findFirst({
      where: { threadId: args.stationThreadId, status: EStationRunStatus.Running },
    })
    if (run === null) {
      throw new ForbiddenException('this sandbox is not a running factory station')
    }
    if (args.branch === 'main' || args.branch === 'master') {
      throw new BadRequestException(`pushing to ${args.branch} is refused — stations never touch it`)
    }
    if (!args.branch.startsWith(FACTORY_BRANCH_PREFIX)) {
      throw new BadRequestException(
        `factory stations push only ${FACTORY_BRANCH_PREFIX}* branches; ${args.branch} is refused`,
      )
    }
    const item = await this.workItems.find({ workItemId: run.workItemId })
    const { owner, repo } = repoCoordinatesOf(item.repo)
    const token = await this.githubApp.installationToken({ owner, repo })
    return { token, expiresInSeconds: GIT_TOKEN_EXPIRY_SECONDS }
  }

  private async orchestratedItem(args: { threadId: string }): Promise<WorkItemDto> {
    const item = await db.factoryWorkItem.findFirst({
      where: { orchestratorThreadId: args.threadId },
    })
    if (item === null) {
      throw new ForbiddenException('this sandbox is not the orchestrator of any work item')
    }
    return item
  }

  private async runningRunOf(args: {
    item: WorkItemDto
    runId: string
  }): Promise<StationRunRow> {
    const run = await db.factoryStationRun.findUnique({ where: { id: args.runId } })
    if (run === null || run.workItemId !== args.item.id) {
      throw new NotFoundException(`unknown station run ${args.runId} on this work item`)
    }
    if (run.status !== EStationRunStatus.Running) {
      throw new ConflictException(`station run ${run.id} is ${run.status}`)
    }
    return run
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

  private async ticketAliasOf(
    item: WorkItemDto,
  ): Promise<{ surface: string; externalId: string }> {
    const aliases = await this.workItems.listAliases({ workItemId: item.id })
    const ticket = aliases.find(
      (alias) => alias.kind === EFactoryAliasKind.Issue || alias.kind === EFactoryAliasKind.Ticket,
    )
    return ticket ?? { surface: item.sourceKind, externalId: item.repo }
  }

  private async injectSpawn(args: {
    userId: string
    threadId: string
    runId: string
    text: string
  }): Promise<void> {
    await this.sandboxes.whenSettled({ threadId: args.threadId })
    await injectIntoServeThread({
      deps: { sandboxes: this.sandboxes, channel: this.channel },
      userId: args.userId,
      threadId: args.threadId,
      text: args.text,
      marker: args.runId,
    })
  }

  private async markRun(args: { runId: string; status: EStationRunStatus }): Promise<void> {
    const at = nowIso()
    await db.factoryStationRun.update({
      where: { id: args.runId },
      data: { status: args.status, updatedAt: at, finishedAt: at },
    })
  }
}
