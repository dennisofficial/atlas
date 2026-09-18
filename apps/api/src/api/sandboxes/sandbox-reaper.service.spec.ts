import 'reflect-metadata'
import { CronExpression } from '@nestjs/schedule'
import { describe, expect, it, vi } from 'vitest'
import { SandboxReaperService } from './sandbox-reaper.service'
import type { SandboxesService } from './sandboxes.service'

describe('SandboxReaperService', () => {
  it('sweeps every minute through the sandboxes service', async () => {
    const reap = vi.fn(async () => 2)
    const reaper = new SandboxReaperService({ reap } as unknown as SandboxesService)

    await expect(reaper.handleSweep()).resolves.toBe(2)
    expect(reap).toHaveBeenCalledTimes(1)

    const schedule = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      SandboxReaperService.prototype.handleSweep,
    ) as { cronTime?: string } | undefined
    expect(schedule?.cronTime).toBe(CronExpression.EVERY_MINUTE)
  })
})
