import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { db } from '../../../db'
import { EFactoryEventKind } from '../factory.types'
import { nextReplyWatchId, nowIso } from '../ids'
import { deliverToServeThread } from '../orchestrator/serve-delivery'
import { factorySandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import { ORCHESTRATOR_CHANNEL, type OrchestratorChannel } from '../orchestrator/orchestrator-channel'
import { EStatusSignal, type StatusSignalRef } from '../status-signal/status-signal'
import { StatusSignalsService } from '../status-signal/status-signals.service'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const REPLY_WATCH_WINDOW_MS = 60_000
export const REPLY_WATCH_GRACE_MS = 60_000

const NUDGE_MARKER_PREFIX = 'reply-watch:'

export type ReplyWatchRow = {
  id: string
  workItemId: string
  surface: string
  externalId: string
  commentId: string
  organizationId: string | null
  eventId: string
  nudgeAt: string
  graceAt: string
  nudged: boolean
}

const rowToRef = (row: ReplyWatchRow): StatusSignalRef => ({
  surface: row.surface as StatusSignalRef['surface'],
  organizationId: row.organizationId ?? '',
  externalId: row.externalId,
  commentId: row.commentId,
})

/**
 * The reply contract's backstop. A human comment on a tracked surface arms a watch: 👀 goes up at
 * once, and if no factory reply lands on that surface within the window the orchestrator is
 * steered — a user-role XML system notice telling it to let the author know what is going on. Any
 * factory-authored reply on the surface clears the watch and the emoji. One nudge, then a single
 * grace window, then the watch stands down — a stuck loop is never spammed.
 *
 * The deadlines are durable rows, not memory: a redeploy or an OOM kill used to drop a pending
 * watch silently. The in-process timer is now only a re-arming view over the durable state, and
 * the boot scan re-arms whatever survived — an overdue row fires immediately rather than waiting
 * out a window that already passed.
 */
@Injectable()
export class ReplyWatchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReplyWatchService.name)
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly signals: StatusSignalsService,
    private readonly sandboxes: SandboxesService,
    private readonly identity: FactoryIdentityService,
    @Inject(ORCHESTRATOR_CHANNEL) private readonly channel: OrchestratorChannel,
  ) {}

  /** Overridable for specs — the production windows are the module constants. */
  windowMs = REPLY_WATCH_WINDOW_MS
  graceMs = REPLY_WATCH_GRACE_MS

  onApplicationBootstrap(): void {
    void this.rearmWatches().catch((failure: unknown) => {
      this.logger.warn(`reply-watch re-arm scan failed: ${messageOf(failure)}`)
    })
  }

  /** Arm a watch on a human comment: heard goes up, the deadline is persisted, the timer starts. */
  watch(args: {
    workItemId: string
    ref: StatusSignalRef
    /** The transcript event id of the human comment — the nudge references it. */
    eventId: string
  }): void {
    void this.arm(args).catch((failure: unknown) => {
      this.logger.warn(`reply-watch failed to arm for ${args.workItemId}: ${messageOf(failure)}`)
    })
  }

  /** Drop every in-process timer without touching the durable rows — a spec stands in for death. */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /** A factory reply landed: mark reply-coming, clear the watch row and the emoji. */
  async resolve(args: { workItemId: string }): Promise<void> {
    const row = await this.rowFor({ workItemId: args.workItemId })
    if (row === null) return
    await this.signals.set({ ref: rowToRef(row), signal: EStatusSignal.ReplyComing })
    await this.removeWatch({ workItemId: args.workItemId })
    await this.signals.clear({ ref: rowToRef(row) })
  }

  private async arm(args: {
    workItemId: string
    ref: StatusSignalRef
    eventId: string
  }): Promise<void> {
    await this.removeWatch({ workItemId: args.workItemId })
    await this.signals.set({ ref: args.ref, signal: EStatusSignal.Heard })
    const now = Date.now()
    const row: ReplyWatchRow = {
      id: nextReplyWatchId(),
      workItemId: args.workItemId,
      surface: args.ref.surface,
      externalId: args.ref.externalId,
      commentId: args.ref.commentId,
      organizationId: args.ref.organizationId,
      eventId: args.eventId,
      nudgeAt: new Date(now + this.windowMs).toISOString(),
      graceAt: new Date(now + this.windowMs + this.graceMs).toISOString(),
      nudged: false,
    }
    await db.factoryReplyWatch.create({
      data: { ...row, createdAt: nowIso(), updatedAt: nowIso() },
    })
    this.armTimer({ row })
  }

  /** Every durable row gets a timer; a restart re-arms without re-setting the heard signal. */
  private async rearmWatches(): Promise<void> {
    const rows = await db.factoryReplyWatch.findMany({ orderBy: { createdAt: 'asc' } })
    for (const row of rows) this.armTimer({ row })
    if (rows.length > 0) this.logger.log(`re-armed ${rows.length} reply watch(es) after a restart`)
  }

  private armTimer(args: { row: ReplyWatchRow }): void {
    const delay = this.timerDelay({ row: args.row })
    this.timers.set(
      args.row.workItemId,
      setTimeout(() => {
        void this.onTimer({ workItemId: args.row.workItemId }).catch((failure: unknown) => {
          this.logger.warn(
            `reply-watch timer failed for ${args.row.workItemId}: ${messageOf(failure)}`,
          )
        })
      }, delay),
    )
  }

  private timerDelay(args: { row: ReplyWatchRow }): number {
    const deadline = args.row.nudged ? args.row.graceAt : args.row.nudgeAt
    return Math.max(0, Date.parse(deadline) - Date.now())
  }

  private async rowFor(args: { workItemId: string }): Promise<ReplyWatchRow | null> {
    const rows = await db.factoryReplyWatch.findMany({ where: { workItemId: args.workItemId } })
    return rows[0] ?? null
  }

  private async removeWatch(args: { workItemId: string }): Promise<void> {
    const timer = this.timers.get(args.workItemId)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(args.workItemId)
    await db.factoryReplyWatch.deleteMany({ where: { workItemId: args.workItemId } })
  }

  private async onTimer(args: { workItemId: string }): Promise<void> {
    const row = await this.rowFor(args)
    if (row === null) {
      this.timers.delete(args.workItemId)
      return
    }
    if (await this.repliedOnSurface({ workItemId: args.workItemId, row })) {
      await this.removeWatch(args)
      return
    }
    if (row.nudged) {
      this.logger.warn(
        `work item ${args.workItemId} still has not replied after a nudge; standing the watch down`,
      )
      await this.removeWatch(args)
      return
    }
    await db.factoryReplyWatch.update({
      where: { id: row.id },
      data: { nudged: true, updatedAt: nowIso() },
    })
    this.armTimer({ row: { ...row, nudged: true } })
    await this.nudge({ workItemId: args.workItemId, row }).catch((failure: unknown) => {
      this.logger.warn(`reply-watch nudge failed for ${args.workItemId}: ${messageOf(failure)}`)
    })
  }

  private async repliedOnSurface(args: {
    workItemId: string
    row: ReplyWatchRow
  }): Promise<boolean> {
    const reply = await db.factoryTranscriptEvent.findFirst({
      where: {
        workItemId: args.workItemId,
        surface: args.row.surface,
        externalId: args.row.externalId,
        kind: EFactoryEventKind.Reply,
      },
      select: { id: true },
    })
    return reply !== null
  }

  private async nudge(args: { workItemId: string; row: ReplyWatchRow }): Promise<void> {
    const item = await db.factoryWorkItem.findUnique({ where: { id: args.workItemId } })
    if (item === null || item.orchestratorThreadId === null) return
    const userId = await this.identity.userId({ organizationId: item.organizationId })
    const marker = `${NUDGE_MARKER_PREFIX}${args.row.eventId}`
    const text = [
      `<system-notice kind="reply-watch" marker="${marker}">`,
      `You have not responded to ${args.row.externalId} yet. The author is waiting — even a one-line "still working on it" is better than silence. Reply on the surface, or if you already did, ignore this.`,
      `</system-notice>`,
    ].join('\n')
    await deliverToServeThread({
      deps: { sandboxes: this.sandboxes, channel: this.channel },
      userId,
      threadId: item.orchestratorThreadId,
      sandboxName: factorySandboxNameFor({ workItemId: args.workItemId }),
      text,
      marker,
    })
    this.logger.log(`reply-watch nudged the orchestrator of work item ${args.workItemId}`)
  }
}
