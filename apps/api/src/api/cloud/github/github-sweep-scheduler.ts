import { Injectable, type DynamicModule, type Provider } from '@nestjs/common'
import { Interval, ScheduleModule } from '@nestjs/schedule'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'
import { GithubDeliveryService } from './github-delivery.service'

export const POLL_SWEEP_INTERVAL_MS = 30_000
export const HOOK_SWEEP_INTERVAL_MS = 60_000
export const WEBHOOK_RECONCILE_INTERVAL_MS = 5 * 60_000

export function runsOffVercel(): boolean {
  return process.env.VERCEL !== '1'
}

@Injectable()
export class GithubSweepSchedulerService {
  constructor(
    private readonly pollSweeper: GithubPollSweeperService,
    private readonly hookLifecycle: GithubHookLifecycleService,
    private readonly webhookInbox: GithubWebhookInboxService,
    private readonly deliveries: GithubDeliveryService,
  ) {}

  @Interval(POLL_SWEEP_INTERVAL_MS)
  async handlePollTick(): Promise<void> {
    await this.pollSweeper.handlePoll()
  }

  @Interval(HOOK_SWEEP_INTERVAL_MS)
  async handleHookTick(): Promise<void> {
    await this.hookLifecycle.handleSweep()
  }

  @Interval(WEBHOOK_RECONCILE_INTERVAL_MS)
  async handleWebhookReconcileTick(): Promise<void> {
    await this.webhookInbox.handleReconcile({
      process: (entry) => this.deliveries.handle(entry),
    })
  }
}

export function sweepSchedulerProviders(): Provider[] {
  return runsOffVercel() ? [GithubSweepSchedulerService] : []
}

export function sweepScheduleImports(): DynamicModule[] {
  return runsOffVercel() ? [ScheduleModule.forRoot()] : []
}
