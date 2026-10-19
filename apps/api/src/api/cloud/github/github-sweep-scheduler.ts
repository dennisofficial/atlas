import { Injectable, type DynamicModule, type Provider } from '@nestjs/common'
import { Interval, ScheduleModule } from '@nestjs/schedule'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'

export const POLL_SWEEP_INTERVAL_MS = 30_000
export const HOOK_SWEEP_INTERVAL_MS = 60_000

export function runsOffVercel(): boolean {
  return process.env.VERCEL !== '1'
}

@Injectable()
export class GithubSweepSchedulerService {
  constructor(
    private readonly pollSweeper: GithubPollSweeperService,
    private readonly hookLifecycle: GithubHookLifecycleService,
  ) {}

  @Interval(POLL_SWEEP_INTERVAL_MS)
  async handlePollTick(): Promise<void> {
    await this.pollSweeper.handlePoll()
  }

  @Interval(HOOK_SWEEP_INTERVAL_MS)
  async handleHookTick(): Promise<void> {
    await this.hookLifecycle.handleSweep()
  }
}

export function sweepSchedulerProviders(): Provider[] {
  return runsOffVercel() ? [GithubSweepSchedulerService] : []
}

export function sweepScheduleImports(): DynamicModule[] {
  return runsOffVercel() ? [ScheduleModule.forRoot()] : []
}
