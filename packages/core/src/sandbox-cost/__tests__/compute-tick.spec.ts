import { describe, expect, test } from 'bun:test'

import { sandboxComputeAt, sandboxComputeOf, type SandboxRunRow } from '../compute'
import { ESandboxCostProvider, ESandboxCostSource } from '../rates'

const HOUR = 3_600_000

const row = (patch: Partial<SandboxRunRow>): SandboxRunRow => ({
  id: 'run-1',
  sessionId: 's-1',
  userId: 'u-1',
  provider: ESandboxCostProvider.Vercel,
  sandboxInstanceId: null,
  vcpus: 4,
  memoryGb: 8,
  diskGb: 0,
  startedAt: 0,
  endedAt: null,
  activeCpuMs: null,
  cpuBaselineMs: 0,
  awakeMs: null,
  costUsd: null,
  costSource: null,
  ...patch,
})

describe('sandboxComputeOf tick', () => {
  test('an open Vercel run advertises the memory rate it accrues', () => {
    const compute = sandboxComputeOf({ rows: [row({})], now: HOUR })
    expect(compute.running).toBe(true)
    expect(compute.tick?.at).toBe(HOUR)
    expect(compute.tick?.rateUsdPerHour).toBeCloseTo(0.0212 * 8, 10)
  })

  test('an open Agent37 run accrues its whole monthly rate', () => {
    const compute = sandboxComputeOf({
      rows: [
        row({
          provider: ESandboxCostProvider.Agent37,
          vcpus: 2,
          memoryGb: 4,
          diskGb: 64,
          costSource: ESandboxCostSource.Estimate,
        }),
      ],
      now: HOUR,
    })
    const monthly = (0.8 * 2 + 0.7 * 4) * 2.5 + 0.09 * 64
    expect(compute.tick?.rateUsdPerHour).toBeCloseTo(monthly / 730, 10)
  })

  test('closed runs leave nothing to tick', () => {
    const compute = sandboxComputeOf({
      rows: [row({ endedAt: HOUR, costUsd: 0.5, costSource: ESandboxCostSource.Measured })],
      now: 2 * HOUR,
    })
    expect(compute.running).toBe(false)
    expect(compute.tick).toBeNull()
    expect(compute.costUsd).toBe(0.5)
  })
})

describe('sandboxComputeOf live cpu', () => {
  test('an open run bills the CPU measured since its baseline', () => {
    const idle = sandboxComputeOf({ rows: [row({ cpuBaselineMs: 1000 })], now: HOUR })
    const busy = sandboxComputeOf({
      rows: [row({ cpuBaselineMs: 1000 })],
      now: HOUR,
      cumulativeCpuMs: 1000 + HOUR,
    })
    expect(busy.costUsd ?? 0).toBeGreaterThan(idle.costUsd ?? 0)
    expect((busy.costUsd ?? 0) - (idle.costUsd ?? 0)).toBeCloseTo(0.128, 9)
  })

  test('a reading below the baseline bills no CPU', () => {
    const compute = sandboxComputeOf({
      rows: [row({ cpuBaselineMs: 5000 })],
      now: 0,
      cumulativeCpuMs: 1000,
    })
    expect(compute.costUsd).toBe(0)
  })
})

describe('sandboxComputeAt', () => {
  test('ages the wall-clock part on the caller clock', () => {
    const at = sandboxComputeOf({ rows: [row({})], now: 0 })
    const later = sandboxComputeAt({ compute: at, now: HOUR / 2 })
    expect(later.costUsd ?? 0).toBeCloseTo(((at.costUsd ?? 0) + 0.0212 * 8 * 0.5) as number, 9)
  })

  test('a clock behind the snapshot does not rewind the estimate', () => {
    const at = sandboxComputeOf({ rows: [row({})], now: HOUR })
    expect(sandboxComputeAt({ compute: at, now: 0 }).costUsd).toBe(at.costUsd)
  })

  test('a session with no runs stays null', () => {
    const empty = sandboxComputeOf({ rows: [], now: HOUR })
    expect(sandboxComputeAt({ compute: empty, now: 2 * HOUR }).costUsd).toBeNull()
  })
})
