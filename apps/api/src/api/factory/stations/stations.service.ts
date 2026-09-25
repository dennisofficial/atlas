import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { db } from '../../../db'
import { factoryStationSandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { ESandboxDriveMode, ESandboxFactoryRole, ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ThreadsService } from '../../platform/sessions/threads.service'
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
import { OrchestratorService } from '../orchestrator/orchestrator.service'
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
    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestrator: OrchestratorService,
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

    const userId = await this.identity.userId({ organizationId: item.organizationId })
    await this.credentials.ensureSeeded({ userId, organizationId: item.organizationId })

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

    await this.attachStation({
      item,
      run: { id: runId, kind, threadId: thread.id },
      userId,
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
      userId: await this.identity.userId({ organizationId: item.organizationId }),
      threadId: run.threadId,
      sandboxName: factoryStationSandboxNameFor({ runId: run.id }),
      text: `[station steer] ${marker}\n\n${args.message}`,
      marker,
    })
    return { steered: true }
  }

  /**
   * The run row is what the spawn guard reads, so a stop whose sandbox row is already gone — a
   * spawn killed mid-provision never writes one — must still mark the run stopped, or the item
   * deadlocks on a zombie.
   */
  async stop(args: { orchestratorThreadId: string; runId: string }): Promise<{ stopped: true }> {
    const item = await orchestratedItem({ threadId: args.orchestratorThreadId })
    const run = await this.runningRun({ item, runId: args.runId })
    try {
      await this.sandboxes.stop({
        userId: await this.identity.userId({ organizationId: item.organizationId }),
        threadId: run.threadId,
      })
    } catch (failure) {
      if (!(failure instanceof NotFoundException)) throw failure
      this.logger.warn(`station run ${run.id} has no sandbox row; marking it stopped anyway`)
    }
    await this.markRun({ runId: run.id, status: EStationRunStatus.Stopped })
    await this.reportRunOutcome({
      runId: run.id,
      status: EStationRunStatus.Stopped,
      reason: 'the orchestrator stopped the run',
    })
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
    const item = await this.workItems.find({ workItemId: args.workItemId })
    const userId = await this.identity.userId({ organizationId: item.organizationId })
    for (const run of running) {
      await this.sandboxes.stop({ userId, threadId: run.threadId }).catch((failure: unknown) => {
        this.logger.warn(`could not stop station run ${run.id}: ${messageOf(failure)}`)
      })
      await this.markRun({ runId: run.id, status: EStationRunStatus.Stopped })
      await this.reportRunOutcome({
        runId: run.id,
        status: EStationRunStatus.Stopped,
        reason: 'the work item reached a terminal state, so the run was stopped',
      })
    }
  }

  /**
   * A run is only a candidate once its station has been silent far longer than any healthy boot.
   * Two terminal rows deserve it: a run whose thread no longer has a live endpoint (its sandbox
   * died without reporting), and a run whose sandbox row is stuck in a non-running state — the
   * wound a mid-spawn container death leaves, where the process holding the provisioning chain was
   * killed before it could stamp the row, so every later injection refuses it. A wedged row is
   * recovered by re-attaching (which re-runs the idempotent provisioning chain and re-stamps) and
   * re-injecting the spawn message; only a run that cannot be brought back is failed and reported.
   */
  async failStuckRuns(args: { silentForMs: number }): Promise<number> {
    const quietBefore = new Date(Date.now() - args.silentForMs).toISOString()
    const running = await db.factoryStationRun.findMany({
      where: { status: EStationRunStatus.Running, updatedAt: { lt: quietBefore } },
    })
    let handled = 0
    for (const run of running) {
      const item = await this.workItems.find({ workItemId: run.workItemId }).catch(() => null)
      if (item === null) continue
      const userId = await this.identity.userId({ organizationId: item.organizationId })
      const endpoint = await this.sandboxes
        .runningEndpoint({ userId, threadId: run.threadId })
        .catch(() => null)
      if (endpoint !== null) continue
      const row = await db.cloudSandbox.findUnique({
        where: { threadId: run.threadId },
        select: { state: true },
      })
      const wedged = row !== null && row.state !== ESandboxState.Running
      if (wedged && (await this.recoverWedged({ item, run, userId }))) {
        handled += 1
        continue
      }
      this.logger.warn(
        `station run ${run.id} has been running for over ${Math.round(args.silentForMs / 60000)}m with no live sandbox; failing it`,
      )
      await this.markRun({ runId: run.id, status: EStationRunStatus.Failed })
      await this.reportRunOutcome({
        runId: run.id,
        status: EStationRunStatus.Failed,
        reason: `the run went silent for over ${Math.round(args.silentForMs / 60000)} minutes and its sandbox no longer has a live endpoint, so the control plane failed it rather than leave the orchestrator waiting`,
      })
      handled += 1
    }
    return handled
  }

  /**
   * Re-drive the spawn of a run whose provisioning chain died with its container. The original
   * request event holds the assignment; re-attaching re-runs the idempotent provisioning chain and
   * re-stamps the row, then the spawn message is injected as if the first attempt had never
   * crashed. Returns false when recovery itself fails, so the caller falls through to failing it.
   */
  private async recoverWedged(args: {
    item: WorkItemDto
    run: { id: string; kind: string; threadId: string }
    userId: string
  }): Promise<boolean> {
    const kind = parseStationKind(args.run.kind)
    if (kind === undefined) return false
    const request = await db.factoryTranscriptEvent.findFirst({
      where: { workItemId: args.item.id, deliveryId: `station-request:${args.run.id}` },
      select: { payload: true },
    })
    if (request === null) return false
    const { message } = JSON.parse(request.payload) as { message: string }
    this.logger.warn(`recovering wedged station run ${args.run.id} by re-attaching its sandbox`)
    try {
      await this.attachStation({
        item: args.item,
        run: { id: args.run.id, kind, threadId: args.run.threadId },
        userId: args.userId,
      })
      const text = stationSpawnMessageFor({
        workItemId: args.item.id,
        runId: args.run.id,
        repo: args.item.repo,
        kind,
        message,
      })
      await this.injectSpawn({
        userId: args.userId,
        threadId: args.run.threadId,
        runId: args.run.id,
        text,
      })
    } catch (failure) {
      this.logger.warn(`could not recover wedged station run ${args.run.id}: ${messageOf(failure)}`)
      return false
    }
    this.logger.log(`recovered wedged station run ${args.run.id}; its spawn message is delivered`)
    return true
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

  private async attachStation(args: {
    item: WorkItemDto
    run: { id: string; kind: EStationKind; threadId: string }
    userId: string
  }): Promise<void> {
    await this.sandboxes.attach({
      userId: args.userId,
      threadId: args.run.threadId,
      name: factoryStationSandboxNameFor({ runId: args.run.id }),
      workspace: {
        remoteUrl: `https://github.com/${args.item.repo}.git`,
        branch: null,
        commit: null,
        patch: '',
      },
      drive: {
        name: await this.drives.ensure({ workItemId: args.item.id }),
        mode: driveModeFor(args.run.kind),
      },
      pinnedModel: await this.credentials.modelRef({ organizationId: args.item.organizationId }),
      factoryRole: ESandboxFactoryRole.Station,
      decisionsUrl: await this.credentials.decisionsUrl({ organizationId: args.item.organizationId }),
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
    // Loud on purpose: a failure that cannot even be recorded is exactly the silent channel the
    // liveness sweep is built to close, so the error is logged, not swallowed into the run row.
    await this.reportRunOutcome({
      runId: args.runId,
      status: EStationRunStatus.Failed,
      reason: `the station never received its spawn message: ${messageOf(args.failure)}`,
    }).catch((failure: unknown) => {
      this.logger.error(
        `station run ${args.runId} failed but its outcome could not be recorded: ${messageOf(failure)}`,
      )
    })
  }

  /**
   * The orchestrator owns the next move once a run dies, so every terminal failure or stop lands
   * on the transcript as a station-result and wakes it — a run must never go dark silently. The
   * event is deduped on its delivery id, so a repeated stop or a race with the result gate records
   * the wake exactly once.
   */
  private async reportRunOutcome(args: {
    runId: string
    status: EStationRunStatus.Failed | EStationRunStatus.Stopped
    reason: string
  }): Promise<void> {
    const run = await db.factoryStationRun.findUnique({ where: { id: args.runId } })
    if (run === null) return
    const item = await this.workItems.find({ workItemId: run.workItemId })
    const alias = await ticketAliasOf({ workItems: this.workItems, item })
    // The append failing is the silence this whole path exists to prevent — let it throw so the
    // caller's error surfaces (and a retry re-attempts the same deduped delivery id) rather than
    // swallow it and leave the run failed with no record.
    const appended = await this.transcript.append({
      surface: alias.surface,
      externalId: alias.externalId,
      deliveryId: `station-outcome:${run.id}:${args.status}`,
      kind: EFactoryEventKind.StationResult,
      author: 'atlas-factory',
      payload: JSON.stringify({
        runId: run.id,
        kind: run.kind,
        status: args.status,
        reason: args.reason,
      }),
    })
    if (appended === null) return
    this.orchestrator.wake({ workItemId: item.id, externalId: alias.externalId })
  }

  private async markRun(args: { runId: string; status: EStationRunStatus }): Promise<void> {
    const at = nowIso()
    await db.factoryStationRun.update({
      where: { id: args.runId },
      data: { status: args.status, updatedAt: at, finishedAt: at },
    })
  }
}
