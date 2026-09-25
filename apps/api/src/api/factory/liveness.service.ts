import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ReplyWatchService } from './reply-watch/reply-watch.service'
import { StationsService } from './stations/stations.service'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * The liveness floor for the orchestrator-as-autonomous-engineer contract: nothing it owes — an
 * unanswered human comment, an in-flight station run — may go dark without a reply, a result, or
 * an explicit report. Two durable obligations are driven here on a tick: reply-watch rows past
 * their nudge time, and station runs still marked running whose sandbox has died. Each failure is
 * isolated so one bad row never starves the rest of the sweep.
 */
@Injectable()
export class FactoryLivenessService {
  private readonly logger = new Logger(FactoryLivenessService.name)

  constructor(
    private readonly replyWatch: ReplyWatchService,
    private readonly stations: StationsService,
  ) {}

  /** A station run is wedged only once it has been silent far longer than any healthy boot. */
  stuckRunSilenceMs = 20 * 60 * 1000

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTick(): Promise<void> {
    await this.replyWatch.sweep().catch((failure: unknown) => {
      this.logger.warn(`reply-watch sweep failed: ${messageOf(failure)}`)
    })
    await this.stations.failStuckRuns({ silentForMs: this.stuckRunSilenceMs }).catch((failure: unknown) => {
      this.logger.warn(`stuck-run sweep failed: ${messageOf(failure)}`)
    })
  }
}
