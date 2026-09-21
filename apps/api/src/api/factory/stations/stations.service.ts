import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import { db } from '../../../db'
import { factoryStationSandboxNameFor } from '../../sandboxes/sandbox-names'
import { ESandboxDriveMode } from '../../sandboxes/sandboxes.types'
import { SandboxesService } from '../../sandboxes/sandboxes.service'
import { ThreadsService } from '../../sessions/threads.service'
import { FactoryDrivesService } from '../drives/drives.service'
import { EFactoryEventKind, EFactoryWorkItemStatus, type WorkItemDto } from '../factory.types'
import { nextStationRunId, nowIso } from '../ids'
import { FactoryCredentialService } from '../orchestrator/factory-credentials'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import {
  ORCHESTRATOR_CHANNEL,
  type OrchestratorChannel,
} from '../orchestrator/orchestrator-channel'
import { deliverToServeThread, injectIntoServeThread } from '../orchestrator/serve-delivery'
import { TranscriptService } from '../transcript.service'
import { WorkItemsService } from '../work-items.service'
import { isUniqueViolation } from '../unique-violation'
import { orchestratedItem, runningRunOf, ticketAliasOf } from './station-lookup'
import { stationSpawnMessageFor } from './station-prompt'
import {
  EStationKind,
  EStationRunStatus,
  MAX_REVISION_CYCLES,
  parseStationKind,
  STATION_MESSAGE_CAP,
  type StationSpawnResult,
} from './station.types'

const driveModeFor = (kind: EStationKind): ESandboxDriveMode =>
  kind === EStationKind.Implementer ? ESandboxDriveMode.ReadWrite : ESandboxDriveMode.Snapshot

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

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
    @Inject(ORCHESTRATOR_CHANNEL) private readonly channel: OrchestratorChannel,
  ) {}

  async spawn(args: {
    orchestratorThreadId: string
    kind: string
    message: string
  }): Promise<StationSpawnResult> {
    const item = await orchestratedItem({ threadId: args.orchestratorThreadId })
    const kind = parseStationKind(args.kind)
    if (kind === undefined) {
      throw new BadRequestException(`unknown station kind ${args.kind}`)
    }
    if (
      item.status === EFactoryWorkItemStatus.Merged ||
      item.status === EFactoryWorkItemStatus.Closed ||
      item.status === EFactoryWorkItemStatus.Stopped
    ) {
      throw new ConflictException(`work item ${item.id} is ${item.status}; no stations run on it`)
    }
    if (kind === EStationKind.Implementer) {
      if (item.revisionCycles > MAX_REVISION_CYCLES) {
        throw new ConflictException(
          `work item ${item.id} has burned its ${MAX_REVISION_CYCLES} revision cycles — report on the surface instead of spawning another implementer`,
        )
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
    }
    if (args.message.length > STATION_MESSAGE_CAP) {
      throw new BadRequestException(`the spawn message is over the ${STATION_MESSAGE_CAP} character cap`)
    }

    const userId = await this.identity.userId()
    await this.credentials.ensureSeeded({ userId })
    const driveName = await this.drives.ensure({ workItemId: item.id })

    const runId = nextStationRunId()
    const thread = await this.threads.create({
      userId,
      draft: { title: `factory ${kind}: ${item.repo}`, repo: item.repo },
    })
    await this.createRun({ item, kind, runId, threadId: thread.id })
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
      drive: { name: driveName, mode: driveModeFor(kind) },
      pinnedModel: this.credentials.modelRef(),
    })

    const alias = await ticketAliasOf({ workItems: this.workItems, item })
    const requestEvent = await this.transcript.append({
      surface: alias.surface,
      externalId: alias.externalId,
      deliveryId: `station-request:${runId}`,
      kind: EFactoryEventKind.StationRequest,
      author: 'atlas-factory',
      payload: JSON.stringify({ runId, kind, message: args.message }),
    })
    if (requestEvent === null) {
      throw new InternalServerErrorException(
        `station request for run ${runId} found no aliased surface to land on`,
      )
    }

    const text = stationSpawnMessageFor({
      workItemId: item.id,
      runId,
      repo: item.repo,
      kind,
      message: args.message,
    })
    void this.injectSpawn({ userId, threadId: thread.id, runId, text }).catch((failure: unknown) =>
      this.handleSpawnFailure({ runId, userId, threadId: thread.id, failure }),
    )

    this.logger.log(`station run ${runId} (${kind}) spawned for work item ${item.id}`)
    return { stationRunId: runId, threadId: thread.id, status: EStationRunStatus.Running }
  }

  async steer(args: {
    orchestratorThreadId: string
    runId: string
    message: string
  }): Promise<{ steered: true }> {
    const item = await orchestratedItem({ threadId: args.orchestratorThreadId })
    const run = await this.runningRun({ item, runId: args.runId })
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
    const item = await orchestratedItem({ threadId: args.orchestratorThreadId })
    const run = await this.runningRun({ item, runId: args.runId })
    await this.sandboxes.stop({ userId: await this.identity.userId(), threadId: run.threadId })
    await this.markRun({ runId: run.id, status: EStationRunStatus.Stopped })
    return { stopped: true }
  }

  /**
   * Terminal work items (merge, close) release the drive — any station still holding it is stopped
   * first, or the drive delete fails on the attached mount and the sweeper owns the retry.
   */
  async stopRunningFor(args: { workItemId: string }): Promise<void> {
    const running = await db.factoryStationRun.findMany({
      where: { workItemId: args.workItemId, status: EStationRunStatus.Running },
    })
    if (running.length === 0) return
    const userId = await this.identity.userId()
    for (const run of running) {
      await this.sandboxes.stop({ userId, threadId: run.threadId }).catch((failure: unknown) => {
        this.logger.warn(`could not stop station run ${run.id}: ${messageOf(failure)}`)
      })
      await this.markRun({ runId: run.id, status: EStationRunStatus.Stopped })
    }
  }

  private async createRun(args: {
    item: WorkItemDto
    kind: EStationKind
    runId: string
    threadId: string
  }): Promise<void> {
    const at = nowIso()
    try {
      await db.factoryStationRun.create({
        data: {
          id: args.runId,
          workItemId: args.item.id,
          kind: args.kind,
          threadId: args.threadId,
          status: EStationRunStatus.Running,
          driveMode: driveModeFor(args.kind),
          createdAt: at,
          updatedAt: at,
          finishedAt: null,
        },
      })
    } catch (error) {
      if (isUniqueViolation(error, ['workItemId'])) {
        throw new ConflictException(
          "another station run took this work item's drive — stop it or let it finish first",
        )
      }
      throw error
    }
  }

  private runningRun(args: { item: WorkItemDto; runId: string }) {
    return runningRunOf({
      item: args.item,
      runId: args.runId,
      notRunning: (run) => new ConflictException(`station run ${run.id} is ${run.status}`),
    })
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

  /**
   * A station that never got its spawn message leaves its sandbox up holding its mount — stop it
   * before failing the run, or the next implementer spawn's single-writer check passes over a
   * live RW mount.
   */
  private async handleSpawnFailure(args: {
    runId: string
    userId: string
    threadId: string
    failure: unknown
  }): Promise<void> {
    this.logger.warn(
      `station run ${args.runId} could not be given its spawn message: ${messageOf(args.failure)}`,
    )
    await this.sandboxes
      .stop({ userId: args.userId, threadId: args.threadId })
      .catch((failure: unknown) => {
        this.logger.warn(`could not stop the failed station sandbox ${args.runId}: ${messageOf(failure)}`)
      })
    await this.markRun({ runId: args.runId, status: EStationRunStatus.Failed }).catch(
      (failure: unknown) => {
        this.logger.warn(`could not mark station run ${args.runId} failed: ${messageOf(failure)}`)
      },
    )
  }

  private async markRun(args: { runId: string; status: EStationRunStatus }): Promise<void> {
    const at = nowIso()
    await db.factoryStationRun.update({
      where: { id: args.runId },
      data: { status: args.status, updatedAt: at, finishedAt: at },
    })
  }
}
