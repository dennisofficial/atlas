import { Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'
import { EFactoryEventKind } from '../factory.types'
import { deliverToServeThread } from '../orchestrator/serve-delivery'
import { factorySandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import { ORCHESTRATOR_CHANNEL, type OrchestratorChannel } from '../orchestrator/orchestrator-channel'
import { Inject } from '@nestjs/common'
import { EStatusSignal, type StatusSignalRef } from '../status-signal/status-signal'
import { StatusSignalsService } from '../status-signal/status-signals.service'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const REPLY_WATCH_WINDOW_MS = 60_000
export const REPLY_WATCH_GRACE_MS = 60_000

const NUDGE_MARKER_PREFIX = 'reply-watch:'

type PendingWatch = {
  ref: StatusSignalRef
  nudgeAt: number
  nudged: boolean
  graceAt: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * The reply contract's backstop. A human comment on a tracked surface arms a watch: 👀 goes up at
 * once, and if no factory reply lands on that surface within the window the orchestrator is
 * steered — a user-role XML system notice telling it to let the author know what is going on. Any
 * factory-authored reply on the surface clears the watch and the emoji. One nudge, then a single
 * grace window, then the watch stands down — a stuck loop is never spammed.
 *
 * The timer is in-process and best-effort: a redeploy drops a pending watch, which the grace
 * design already tolerates.
 */
@Injectable()
export class ReplyWatchService {
  private readonly logger = new Logger(ReplyWatchService.name)
  private readonly watches = new Map<string, PendingWatch>()

  constructor(
    private readonly signals: StatusSignalsService,
    private readonly sandboxes: SandboxesService,
    private readonly identity: FactoryIdentityService,
    @Inject(ORCHESTRATOR_CHANNEL) private readonly channel: OrchestratorChannel,
  ) {}

  /** Overridable for specs — the production windows are the module constants. */
  windowMs = REPLY_WATCH_WINDOW_MS
  graceMs = REPLY_WATCH_GRACE_MS

  /** Arm a watch on a human comment: heard goes up, the nudge timer starts. */
  watch(args: {
    workItemId: string
    ref: StatusSignalRef
    /** The transcript event id of the human comment — the nudge references it. */
    eventId: string
  }): void {
    this.clearWatch({ workItemId: args.workItemId })
    void this.signals.set({ ref: args.ref, signal: EStatusSignal.Heard })
    const now = Date.now()
    const pending: PendingWatch = {
      ref: args.ref,
      nudgeAt: now + this.windowMs,
      nudged: false,
      graceAt: now + this.windowMs + this.graceMs,
      timer: setTimeout(() => {
        void this.onTimer({ workItemId: args.workItemId, eventId: args.eventId })
      }, this.windowMs),
    }
    this.watches.set(args.workItemId, pending)
  }

  /** A factory reply landed: mark reply-coming, clear the watch and the emoji. */
  async resolve(args: { workItemId: string }): Promise<void> {
    const pending = this.watches.get(args.workItemId)
    if (pending === undefined) return
    await this.signals.set({ ref: pending.ref, signal: EStatusSignal.ReplyComing })
    this.clearWatch({ workItemId: args.workItemId })
    await this.signals.clear({ ref: pending.ref })
  }

  private clearWatch(args: { workItemId: string }): void {
    const pending = this.watches.get(args.workItemId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.watches.delete(args.workItemId)
  }

  private async onTimer(args: { workItemId: string; eventId: string }): Promise<void> {
    const pending = this.watches.get(args.workItemId)
    if (pending === undefined) return
    if (await this.repliedOnSurface({ workItemId: args.workItemId, ref: pending.ref })) {
      this.clearWatch({ workItemId: args.workItemId })
      return
    }
    if (pending.nudged) {
      this.logger.warn(
        `work item ${args.workItemId} still has not replied after a nudge; standing the watch down`,
      )
      this.clearWatch({ workItemId: args.workItemId })
      return
    }
    pending.nudged = true
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      void this.onTimer(args)
    }, this.graceMs)
    await this.nudge(args, pending).catch((failure: unknown) => {
      this.logger.warn(`reply-watch nudge failed for ${args.workItemId}: ${messageOf(failure)}`)
    })
  }

  private async repliedOnSurface(args: {
    workItemId: string
    ref: StatusSignalRef
  }): Promise<boolean> {
    const reply = await db.factoryTranscriptEvent.findFirst({
      where: {
        workItemId: args.workItemId,
        surface: args.ref.surface,
        externalId: args.ref.externalId,
        kind: EFactoryEventKind.Reply,
      },
      select: { id: true },
    })
    return reply !== null
  }

  private async nudge(args: { workItemId: string; eventId: string }, pending: PendingWatch): Promise<void> {
    const item = await db.factoryWorkItem.findUnique({ where: { id: args.workItemId } })
    if (item === null || item.orchestratorThreadId === null) return
    const userId = await this.identity.userId({ organizationId: item.organizationId })
    const marker = `${NUDGE_MARKER_PREFIX}${args.eventId}`
    const text = [
      `<system-notice kind="reply-watch" marker="${marker}">`,
      `You have not responded to ${pending.ref.externalId} yet. The author is waiting — even a one-line "still working on it" is better than silence. Reply on the surface, or if you already did, ignore this.`,
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
