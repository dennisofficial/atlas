import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { db } from '../../../db'
import type { TranscriptEventDto } from '../factory.types'
import { EFactoryEventKind } from '../factory.types'
import { TranscriptService } from '../transcript.service'
import {
  claimNextWake,
  EWakeOutboxStatus,
  markWakeDelivered,
  pruneDeliveredWakes,
  recoverAbandonedWakes,
  resetWake,
} from './wake-outbox'

/**
 * A wake's drive lives in process memory, so a redeploy or an OOM kill abandons whatever was in
 * flight. Two layers of durable state catch it: the transcript plus delivered watermark (an item
 * whose events were never reached is re-driven), and the wake outbox (a wake enqueued or started
 * before the kill is drained on boot). Re-delivery is idempotent — each event carries a commit
 * marker (`serveMessageCommitted`) and the watermark only advances after a commit — so an item
 * that was actually delivered before the crash just no-ops.
 */
const OWN_KINDS: readonly string[] = [
  EFactoryEventKind.Reply,
  EFactoryEventKind.StationRequest,
  EFactoryEventKind.Delivery,
]

export function undeliveredEventsOf(args: {
  events: readonly TranscriptEventDto[]
  watermark: string | null
}): TranscriptEventDto[] {
  const events = args.events.filter((event) => !OWN_KINDS.includes(event.kind))
  if (args.watermark === null) return [...events]
  const index = events.findIndex((event) => event.id === args.watermark)
  return index === -1 ? [...events] : events.slice(index + 1)
}

export interface WakeRecoveryDriver {
  runWake(args: { workItemId: string; externalId: string; repo?: string }): Promise<void>
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class WakeRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WakeRecoveryService.name)
  private driver: WakeRecoveryDriver | null = null

  constructor(private readonly transcript: TranscriptService) {}

  /** The orchestrator registers itself; the service is created before its lock is ready. */
  registerDriver(driver: WakeRecoveryDriver): void {
    this.driver = driver
  }

  /** Returns the recovery promise so a spec can await it; Nest ignores the return. */
  onApplicationBootstrap(): Promise<void> {
    return this.recoverPending().catch((failure: unknown) => {
      const detail =
        failure instanceof Error
          ? `${failure.name}: ${failure.message}${failure.stack === undefined ? '' : `\n${failure.stack}`}`
          : String(failure)
      this.logger.warn(`wake recovery scan failed: ${detail}`)
    })
  }

  /**
   * The wake worker's pass: each drained row runs through the shared drive and lock. A failed
   * drive is reset to enqueued and the pass stops — re-claiming the same row at once would spin on
   * a poisoned wake, and the next `wake()` or boot scan drives it again. Rows after it still run
   * on that later pass, never starved, because the claim is FIFO and the failed row goes to the
   * back only by its original createdAt.
   */
  async drainOutbox(): Promise<void> {
    for (;;) {
      const row = await claimNextWake()
      if (row === null) return
      if (this.driver === null) {
        this.logger.warn(`wake outbox has a pending wake but no driver is registered yet`)
        await resetWake({ id: row.id })
        return
      }
      try {
        await this.driver.runWake({
          workItemId: row.workItemId,
          externalId: row.externalId,
          ...(row.repo === null ? {} : { repo: row.repo }),
        })
        await markWakeDelivered({ id: row.id })
      } catch (failure) {
        await resetWake({ id: row.id })
        this.logger.warn(
          `wake outbox drive failed for work item ${row.workItemId}: ${messageOf(failure)}`,
        )
        throw failure
      }
    }
  }

  private async recoverPending(): Promise<void> {
    const abandoned = await recoverAbandonedWakes()
    if (abandoned > 0) {
      this.logger.log(`re-enqueued ${abandoned} wake(s) abandoned mid-drive by a restart`)
    }
    await this.scanWatermarks()
    await this.drainOutbox()
    await pruneDeliveredWakes()
  }

  /**
   * The backstop for a wake that never reached the outbox at all — a kill between the transcript
   * commit and the enqueue. Any work item with events past its watermark and no wake already
   * queued gets a fresh drive; the drive itself no-ops when the events turn out to be delivered.
   * An item with a pending outbox row is skipped — the drain drives it once, not twice.
   */
  private async scanWatermarks(): Promise<void> {
    const queued = await db.factoryWakeOutbox.findMany({
      where: { status: { in: [EWakeOutboxStatus.Enqueued, EWakeOutboxStatus.Started] } },
      select: { workItemId: true },
    })
    const covered = new Set(queued.map((one) => one.workItemId))
    const rows = await db.factoryWorkItem.findMany({
      select: {
        id: true,
        repo: true,
        orchestratorDeliveredEventId: true,
        aliases: { select: { externalId: true }, take: 1 },
      },
    })
    let recovered = 0
    for (const row of rows) {
      if (covered.has(row.id)) continue
      const events = await this.transcript.list({ workItemId: row.id })
      const pending = undeliveredEventsOf({
        events,
        watermark: row.orchestratorDeliveredEventId,
      })
      if (pending.length === 0) continue
      if (this.driver === null) {
        this.logger.warn('wake recovery found pending work but no driver is registered yet')
        return
      }
      recovered += 1
      const externalId = row.aliases?.[0]?.externalId ?? row.id
      this.logger.log(
        `re-driving ${pending.length} undelivered event(s) for work item ${row.id} after a restart`,
      )
      await this.driver.runWake({ workItemId: row.id, externalId, repo: row.repo })
    }
    if (recovered > 0) this.logger.log(`wake recovery re-drove ${recovered} work item(s)`)
  }
}
