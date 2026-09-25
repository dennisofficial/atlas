import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { StationsService } from './stations/stations.service'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * The liveness floor for the orchestrator-as-autonomous-engineer contract: an in-flight station
 * run may never go dark without a result or an explicit report. The tick fails station runs still
 * marked running whose sandbox has died; unanswered human comments ride the reply-watch service's
 * own durable timers, re-armed on boot, so they need no sweep here.
 */
@Injectable()
export class FactoryLivenessService {
  private readonly logger = new Logger(FactoryLivenessService.name)

  constructor(private readonly stations: StationsService) {}

  /** A station run is wedged only once it has been silent far longer than any healthy boot. */
  stuckRunSilenceMs = 20 * 60 * 1000

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTick(): Promise<void> {
    await this.stations.failStuckRuns({ silentForMs: this.stuckRunSilenceMs }).catch((failure: unknown) => {
      this.logger.warn(`stuck-run sweep failed: ${messageOf(failure)}`)
    })
  }
}
