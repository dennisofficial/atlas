import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { db } from '../../../db'
import type { TranscriptEventDto } from '../factory.types'
import { EFactoryEventKind } from '../factory.types'
import { TranscriptService } from '../transcript.service'

/**
 * A wake's drive lives in process memory, so a redeploy or an OOM kill abandons whatever was in
 * flight. The transcript and the delivered watermark are durable, though, so on boot every work
 * item with transcript events the orchestrator never reached is re-driven here. Re-delivery is
 * idempotent — each event carries a commit marker (`serveMessageCommitted`) and the watermark only
 * advances after a commit — so an item that was actually delivered before the crash just no-ops.
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
  runWake(args: { workItemId: string; externalId: string }): Promise<void>
}

@Injectable()
export class WakeRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WakeRecoveryService.name)
  private driver: WakeRecoveryDriver | null = null

  constructor(private readonly transcript: TranscriptService) {}

  /** The orchestrator registers itself; the service is created before its lock is ready. */
  registerDriver(driver: WakeRecoveryDriver): void {
    this.driver = driver
  }

  onApplicationBootstrap(): void {
    void this.recoverPending().catch((failure: unknown) => {
      this.logger.warn(
        `wake recovery scan failed: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
    })
  }

  private async recoverPending(): Promise<void> {
    const rows = await db.factoryWorkItem.findMany({
      select: {
        id: true,
        orchestratorDeliveredEventId: true,
        aliases: { select: { externalId: true }, take: 1 },
      },
    })
    let recovered = 0
    for (const row of rows) {
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
      const externalId = row.aliases[0]?.externalId ?? row.id
      this.logger.log(
        `re-driving ${pending.length} undelivered event(s) for work item ${row.id} after a restart`,
      )
      await this.driver.runWake({ workItemId: row.id, externalId })
    }
    if (recovered > 0) this.logger.log(`wake recovery re-drove ${recovered} work item(s)`)
  }
}
