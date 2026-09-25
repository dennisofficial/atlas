import { Injectable, Logger } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { db } from '../../../db'
import { factorySandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { EFactoryEventKind } from '../factory.types'
import { nextReplyWatchId, nowIso } from '../ids'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import {
  ORCHESTRATOR_CHANNEL,
  type OrchestratorChannel,
} from '../orchestrator/orchestrator-channel'
import { deliverToServeThread } from '../orchestrator/serve-delivery'
import { EStatusSignal, type StatusSignalRef } from '../status-signal/status-signal'
import { StatusSignalsService } from '../status-signal/status-signals.service'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const REPLY_WATCH_WINDOW_MS = 60_000
export const REPLY_WATCH_GRACE_MS = 60_000

const NUDGE_MARKER_PREFIX = 'reply-watch:'

export enum EReplyWatchStatus {
  Pending = 'pending',
  Resolved = 'resolved',
  StoodDown = 'stood-down',
}

type ReplyWatchRow = {
  id: string
  workItemId: string
  surface: string
  externalId: string
  commentId: string | null
  eventId: string
  organizationId: string | null
  status: string
  nudgeAt: string
  expireAt: string
}

/**
 * The reply contract's backstop, made durable. A human comment on a tracked surface records a
 * watch row and puts 👀 up at once; the liveness sweep reads the rows and, if no factory reply has
 * landed on the surface once `nudgeAt` passes, steers the orchestrator with a user-role system
 * notice. Any factory-authored reply on the surface resolves the row and clears the emoji. One
 * nudge, then the watch stands down at `expireAt` — a stuck loop is never spammed.
 *
 * The timers are rows, not in-process `setTimeout`s, so a redeploy or an OOM kill no longer drops
 * a pending nudge: the sweep re-derives what is due from the database on every tick.
 */
@Injectable()
export class ReplyWatchService {
  private readonly logger = new Logger(ReplyWatchService.name)

  constructor(
    private readonly signals: StatusSignalsService,
    private readonly sandboxes: SandboxesService,
    private readonly identity: FactoryIdentityService,
    @Inject(ORCHESTRATOR_CHANNEL) private readonly channel: OrchestratorChannel,
  ) {}

  /** Overridable for specs — the production windows are the module constants. */
  windowMs = REPLY_WATCH_WINDOW_MS
  graceMs = REPLY_WATCH_GRACE_MS

  /** Arm a watch on a human comment: heard goes up, a durable watch row is recorded. */
  async watch(args: {
    workItemId: string
    ref: StatusSignalRef
    /** The transcript event id of the human comment — the nudge references it. */
    eventId: string
  }): Promise<void> {
    await this.resolveRows({ workItemId: args.workItemId })
    void this.signals.set({ ref: args.ref, signal: EStatusSignal.Heard })
    const now = Date.now()
    const at = nowIso()
    await db.factoryReplyWatch.create({
      data: {
        id: nextReplyWatchId(),
        workItemId: args.workItemId,
        surface: args.ref.surface,
        externalId: args.ref.externalId,
        commentId: args.ref.commentId === undefined ? null : String(args.ref.commentId),
        eventId: args.eventId,
        organizationId: args.ref.organizationId ?? null,
        status: EReplyWatchStatus.Pending,
        nudgeAt: new Date(now + this.windowMs).toISOString(),
        expireAt: new Date(now + this.windowMs + this.graceMs).toISOString(),
        createdAt: at,
        updatedAt: at,
      },
    })
  }

  /** A factory reply landed: mark reply-coming, resolve the open rows and clear the emoji. */
  async resolve(args: { workItemId: string }): Promise<void> {
    const open = await db.factoryReplyWatch.findMany({
      where: { workItemId: args.workItemId, status: EReplyWatchStatus.Pending },
    })
    if (open.length === 0) return
    for (const row of open) {
      await this.signals
        .set({ ref: this.refOf(row), signal: EStatusSignal.ReplyComing })
        .catch(() => undefined)
    }
    await this.resolveRows({ workItemId: args.workItemId })
    for (const row of open) {
      await this.signals.clear({ ref: this.refOf(row) }).catch(() => undefined)
    }
  }

  private async resolveRows(args: { workItemId: string }): Promise<void> {
    await db.factoryReplyWatch.updateMany({
      where: { workItemId: args.workItemId, status: EReplyWatchStatus.Pending },
      data: { status: EReplyWatchStatus.Resolved, updatedAt: nowIso() },
    })
  }

  /**
   * One sweep tick over the durable rows. A watch whose surface has since been replied to resolves
   * quietly; one past its nudge time nudges the orchestrator; one past its grace window stands
   * down. Self-clearing rows (their surface got a reply between ticks) never fire.
   */
  async sweep(): Promise<number> {
    const now = nowIso()
    const due = await db.factoryReplyWatch.findMany({
      where: { status: EReplyWatchStatus.Pending, nudgeAt: { lte: now } },
    })
    let nudged = 0
    for (const row of due) {
      nudged += (await this.handleDue(row, now)) ? 1 : 0
    }
    return nudged
  }

  private async handleDue(row: ReplyWatchRow, now: string): Promise<boolean> {
    if (await this.repliedOnSurface(row)) {
      await this.closeRow({ id: row.id, status: EReplyWatchStatus.Resolved })
      return false
    }
    if (row.expireAt <= now) {
      this.logger.warn(
        `work item ${row.workItemId} still has not replied after a nudge; standing the watch down`,
      )
      await this.closeRow({ id: row.id, status: EReplyWatchStatus.StoodDown })
      return false
    }
    await this.nudge(row).catch((failure: unknown) => {
      this.logger.warn(`reply-watch nudge failed for ${row.workItemId}: ${messageOf(failure)}`)
    })
    // Re-arm past the grace window so a failed nudge is retried once rather than spammed each tick.
    await db.factoryReplyWatch.update({
      where: { id: row.id },
      data: { nudgeAt: row.expireAt, updatedAt: nowIso() },
    })
    return true
  }

  private async closeRow(args: { id: string; status: EReplyWatchStatus }): Promise<void> {
    await db.factoryReplyWatch.update({
      where: { id: args.id },
      data: { status: args.status, updatedAt: nowIso() },
    })
  }

  private refOf(row: ReplyWatchRow): StatusSignalRef {
    return {
      surface: row.surface as StatusSignalRef['surface'],
      organizationId: row.organizationId ?? '',
      externalId: row.externalId,
      commentId: row.commentId ?? '',
    }
  }

  private async repliedOnSurface(row: ReplyWatchRow): Promise<boolean> {
    const reply = await db.factoryTranscriptEvent.findFirst({
      where: {
        workItemId: row.workItemId,
        surface: row.surface,
        externalId: row.externalId,
        kind: EFactoryEventKind.Reply,
      },
      select: { id: true },
    })
    return reply !== null
  }

  private async nudge(row: ReplyWatchRow): Promise<void> {
    const item = await db.factoryWorkItem.findUnique({ where: { id: row.workItemId } })
    if (item === null || item.orchestratorThreadId === null) return
    const userId = await this.identity.userId({ organizationId: item.organizationId })
    const marker = `${NUDGE_MARKER_PREFIX}${row.eventId}`
    const text = [
      `<system-notice kind="reply-watch" marker="${marker}">`,
      `You have not responded to ${row.externalId} yet. The author is waiting — even a one-line "still working on it" is better than silence. Reply on the surface, or if you already did, ignore this.`,
      `</system-notice>`,
    ].join('\n')
    await deliverToServeThread({
      deps: { sandboxes: this.sandboxes, channel: this.channel },
      userId,
      threadId: item.orchestratorThreadId,
      sandboxName: factorySandboxNameFor({ workItemId: row.workItemId }),
      text,
      marker,
    })
    this.logger.log(`reply-watch nudged the orchestrator of work item ${row.workItemId}`)
  }
}
