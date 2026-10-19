import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SAVED_VERCEL = process.env.VERCEL

afterEach(() => {
  if (SAVED_VERCEL === undefined) delete process.env.VERCEL
  else process.env.VERCEL = SAVED_VERCEL
  vi.resetModules()
})

async function loadRealtimeModuleProviders(args: { vercel: string | undefined }): Promise<unknown[]> {
  if (args.vercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = args.vercel
  vi.resetModules()
  const { GithubRealtimeModule } = await import('./github-realtime.module')
  return Reflect.getMetadata('providers', GithubRealtimeModule) as unknown[]
}

describe('github sweep scheduler gating', () => {
  it('registers the scheduler service off Vercel', async () => {
    const providers = await loadRealtimeModuleProviders({ vercel: undefined })
    const { GithubSweepSchedulerService } = await import('./github-sweep-scheduler')

    expect(providers).toContain(GithubSweepSchedulerService)
  })

  it('leaves the scheduler service out on Vercel', async () => {
    const providers = await loadRealtimeModuleProviders({ vercel: '1' })
    const { GithubSweepSchedulerService } = await import('./github-sweep-scheduler')

    expect(providers).not.toContain(GithubSweepSchedulerService)
  })

  it('imports the schedule module only off Vercel', async () => {
    delete process.env.VERCEL
    const { sweepScheduleImports } = await import('./github-sweep-scheduler')
    expect(sweepScheduleImports()).toHaveLength(1)

    process.env.VERCEL = '1'
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
})
