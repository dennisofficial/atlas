import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'bun:test'

const SAVED_FLAG = process.env.GITHUB_SWEEPS_IN_PROCESS
let freshLoads = 0

afterEach(() => {
  if (SAVED_FLAG === undefined) delete process.env.GITHUB_SWEEPS_IN_PROCESS
  else process.env.GITHUB_SWEEPS_IN_PROCESS = SAVED_FLAG
})

async function loadRealtimeModuleProviders(args: {
  sweeps: string | undefined
}): Promise<unknown[]> {
  if (args.sweeps === undefined) delete process.env.GITHUB_SWEEPS_IN_PROCESS
  else process.env.GITHUB_SWEEPS_IN_PROCESS = args.sweeps
  freshLoads += 1
  const { GithubRealtimeModule } = await import(`./github-realtime.module.ts?fresh=${freshLoads}`)
  return Reflect.getMetadata('providers', GithubRealtimeModule) as unknown[]
}

describe('github sweep scheduler gating', () => {
  it('registers the scheduler service when sweeps are opt-in', async () => {
    const providers = await loadRealtimeModuleProviders({ sweeps: '1' })
    const { GithubSweepSchedulerService } = await import('./github-sweep-scheduler')

    expect(providers).toContain(GithubSweepSchedulerService)
  })

  it('leaves the scheduler service out by default', async () => {
    const providers = await loadRealtimeModuleProviders({ sweeps: undefined })
    const { GithubSweepSchedulerService } = await import('./github-sweep-scheduler')

    expect(providers).not.toContain(GithubSweepSchedulerService)
  })

  it('imports the schedule module only when sweeps are opt-in', async () => {
    process.env.GITHUB_SWEEPS_IN_PROCESS = '1'
    const { sweepScheduleImports } = await import('./github-sweep-scheduler')
    expect(sweepScheduleImports()).toHaveLength(1)

    delete process.env.GITHUB_SWEEPS_IN_PROCESS
    expect(sweepScheduleImports()).toHaveLength(0)
  })

  it('keeps the 30 s and 60 s cadences on the interval decorators', async () => {
    const { GithubSweepSchedulerService, POLL_SWEEP_INTERVAL_MS, HOOK_SWEEP_INTERVAL_MS } =
      await import('./github-sweep-scheduler')
    const intervalOf = (method: 'handlePollTick' | 'handleHookTick'): unknown =>
      (
        Reflect.getMetadata(
          'SCHEDULE_INTERVAL_OPTIONS',
          GithubSweepSchedulerService.prototype[method],
        ) as { timeout: number }
      ).timeout

    expect(intervalOf('handlePollTick')).toBe(POLL_SWEEP_INTERVAL_MS)
    expect(intervalOf('handleHookTick')).toBe(HOOK_SWEEP_INTERVAL_MS)
    expect([POLL_SWEEP_INTERVAL_MS, HOOK_SWEEP_INTERVAL_MS]).toEqual([30_000, 60_000])
  })

  it('runs the workflow-run sweep after the pull-request sweep on each poll tick', async () => {
    const { GithubSweepSchedulerService } = await import('./github-sweep-scheduler')
    const calls: string[] = []
    const scheduler = new GithubSweepSchedulerService(
      { handlePoll: async () => void calls.push('poll') } as never,
      { handleSweep: async () => void calls.push('hook-sweep') } as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await scheduler.handlePollTick()

    expect(calls).toEqual(['poll'])
  })

  it('drains and prunes the pr outbox on each webhook reconcile tick', async () => {
    const { GithubSweepSchedulerService } = await import('./github-sweep-scheduler')
    const calls: string[] = []
    const scheduler = new GithubSweepSchedulerService(
      {} as never,
      {} as never,
      { handleReconcile: async () => void calls.push('reconcile') } as never,
      {} as never,
      {
        drain: async () => void calls.push('drain'),
        prune: async () => void calls.push('prune'),
      } as never,
    )

    await scheduler.handleWebhookReconcileTick()

    expect(calls).toEqual(['reconcile', 'drain', 'prune'])
  })
})
