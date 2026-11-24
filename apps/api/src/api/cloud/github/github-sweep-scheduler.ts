import type { BeforeApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common'
import { Injectable, Logger } from '@nestjs/common'
import { GithubHookSweepService } from '@dltech/atlas-github'
import { GithubPollSweeperService } from '@dltech/atlas-github'
import { GithubPrOutboxDispatcher } from '@dltech/atlas-github'
import { GithubWebhookInboxService } from '@dltech/atlas-github'
import { GithubDeliveryService } from '@dltech/atlas-github'
import { EnvService } from '../../../_core/config/env/env.service'

export const POLL_SWEEP_INTERVAL_MS = 30_000
export const HOOK_SWEEP_INTERVAL_MS = 60_000
export const WEBHOOK_RECONCILE_INTERVAL_MS = 60_000

@Injectable()
export class GithubSweepSchedulerService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(GithubSweepSchedulerService.name)
  private timers: ReturnType<typeof setInterval>[] = []

  constructor(
    private readonly pollSweeper: GithubPollSweeperService,
    private readonly hookSweep: GithubHookSweepService,
    private readonly webhookInbox: GithubWebhookInboxService,
    private readonly deliveries: GithubDeliveryService,
    private readonly outbox: GithubPrOutboxDispatcher,
    private readonly env: EnvService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.get('GITHUB_SWEEPS_IN_PROCESS') !== '1') return
    this.timers = [
      this.every({ ms: POLL_SWEEP_INTERVAL_MS, tick: () => this.handlePollTick() }),
      this.every({ ms: HOOK_SWEEP_INTERVAL_MS, tick: () => this.handleHookTick() }),
      this.every({
        ms: WEBHOOK_RECONCILE_INTERVAL_MS,
        tick: () => this.handleWebhookReconcileTick(),
      }),
    ]
  }

  beforeApplicationShutdown(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }

  async handlePollTick(): Promise<void> {
    await this.pollSweeper.handlePoll()
  }

  async handleHookTick(): Promise<void> {
    await this.hookSweep.handleSweep()
  }

  async handleWebhookReconcileTick(): Promise<void> {
    await this.webhookInbox.handleReconcile({
      process: (entry) => this.deliveries.handle({ ...entry, replay: true }),
    })
    await this.outbox.drain()
    await this.outbox.prune({ now: new Date() })
  }

  private every(args: { ms: number; tick: () => Promise<void> }): ReturnType<typeof setInterval> {
    return setInterval(() => void this.runTick(args.tick), args.ms)
  }

  private async runTick(tick: () => Promise<void>): Promise<void> {
    try {
      await tick()
    } catch (error) {
      this.logger.error(error)
    }
  }
}
