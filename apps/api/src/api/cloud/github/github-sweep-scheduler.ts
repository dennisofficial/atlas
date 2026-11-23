import { Injectable, type DynamicModule, type Provider } from '@nestjs/common'
import { Interval, ScheduleModule } from '@nestjs/schedule'
import { GithubHookSweepService } from '@dltech/atlas-github'
import { GithubPollSweeperService } from '@dltech/atlas-github'
import { GithubPrOutboxDispatcher } from '@dltech/atlas-github'
import { GithubWebhookInboxService } from '@dltech/atlas-github'
import { GithubDeliveryService } from '@dltech/atlas-github'

export const POLL_SWEEP_INTERVAL_MS = 30_000
export const HOOK_SWEEP_INTERVAL_MS = 60_000
export const WEBHOOK_RECONCILE_INTERVAL_MS = 60_000

export function githubSweepsInProcess(): boolean {
  return process.env.GITHUB_SWEEPS_IN_PROCESS === '1'
}

@Injectable()
export class GithubSweepSchedulerService {
  constructor(
    private readonly pollSweeper: GithubPollSweeperService,
    private readonly hookSweep: GithubHookSweepService,
    private readonly webhookInbox: GithubWebhookInboxService,
    private readonly deliveries: GithubDeliveryService,
    private readonly outbox: GithubPrOutboxDispatcher,
  ) {}

  @Interval(POLL_SWEEP_INTERVAL_MS)
  async handlePollTick(): Promise<void> {
    await this.pollSweeper.handlePoll()
  }

  @Interval(HOOK_SWEEP_INTERVAL_MS)
  async handleHookTick(): Promise<void> {
    await this.hookSweep.handleSweep()
  }

  @Interval(WEBHOOK_RECONCILE_INTERVAL_MS)
  async handleWebhookReconcileTick(): Promise<void> {
    await this.webhookInbox.handleReconcile({
      process: (entry) => this.deliveries.handle({ ...entry, replay: true }),
    })
    await this.outbox.drain()
    await this.outbox.prune({ now: new Date() })
  }
}

export function sweepSchedulerProviders(): Provider[] {
  return githubSweepsInProcess() ? [GithubSweepSchedulerService] : []
}

export function sweepScheduleImports(): DynamicModule[] {
  return githubSweepsInProcess() ? [ScheduleModule.forRoot()] : []
}
