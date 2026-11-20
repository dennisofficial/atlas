import { describe, expect, test } from 'bun:test'

import { sandboxComputeOf, type SandboxRunRow } from '../compute'
import { estimateSandboxRunCostUsd, sandboxRunCostUsd } from '../cost'
import { ESandboxCostProvider, ESandboxCostSource, rateAt } from '../rates'

const HOUR = 3_600_000
const vercelRun = {
  provider: ESandboxCostProvider.Vercel,
  vcpus: 4,
  memoryGb: 8,
  diskGb: 0,
  startedAt: 0,
}

describe('rateAt', () => {
  test('picks the rate in force at the given time', () => {
    const before = Date.parse('2026-09-01T00:00:00Z')
    const after = Date.parse('2026-09-10T00:00:00Z')
    expect(rateAt({ provider: ESandboxCostProvider.Vercel, at: before }).effectiveFrom).toBe(
      '2026-09-10',
    )
    expect(rateAt({ provider: ESandboxCostProvider.Vercel, at: after }).effectiveFrom).toBe(
      '2026-09-10',
    )
  })

  test('agent37 rates are separate from vercel', () => {
    const rates = rateAt({
      provider: ESandboxCostProvider.Agent37,
      at: Date.parse('2026-11-20T00:00:00Z'),
    })
    expect(rates.provider).toBe(ESandboxCostProvider.Agent37)
  })
})

describe('sandboxRunCostUsd', () => {
  test('vercel charges active cpu and memory wall clock to the minute', () => {
    const cost = sandboxRunCostUsd({
      ...vercelRun,
      endedAt: 90_000,
      activeCpuMs: 30 * 60_000,
    })
    const cpu = (0.128 * (30 * 60_000)) / HOUR
    const memory = (0.0212 * 8 * 120_000) / HOUR
    expect(cost).toBeCloseTo(cpu + memory, 6)
  })

  test('vercel rounds a partial minute up', () => {
    const cost = sandboxRunCostUsd({ ...vercelRun, endedAt: 1_000 })
    expect(cost).toBeCloseTo((0.0212 * 8 * 60_000) / HOUR, 6)
  })

  test('agent37 bills awake hours with the vm type multiplier and disk', () => {
    const cost = sandboxRunCostUsd({
      provider: ESandboxCostProvider.Agent37,
      vcpus: 2,
      memoryGb: 4,
      diskGb: 64,
      startedAt: 0,
      endedAt: 30 * HOUR,
    })
    const monthly = (0.8 * 2 + 0.7 * 4) * 2.5 + 0.09 * 64
    expect(cost).toBeCloseTo((monthly / 730) * 30, 6)
  })

  test('agent37 bills the awake time it is given, not the wall clock', () => {
    const cost = sandboxRunCostUsd({
      provider: ESandboxCostProvider.Agent37,
      vcpus: 2,
      memoryGb: 4,
      diskGb: 64,
      startedAt: 0,
      endedAt: 10 * HOUR,
      awakeMs: HOUR,
    })
    const monthly = (0.8 * 2 + 0.7 * 4) * 2.5 + 0.09 * 64
    expect(cost).toBeCloseTo(monthly / 730, 6)
  })
})

describe('estimateSandboxRunCostUsd', () => {
  test('prices a running vercel run from now with no cpu yet', () => {
    const run = { ...vercelRun, endedAt: 0 }
    const estimate = estimateSandboxRunCostUsd({ run, now: HOUR })
    expect(estimate).toBeCloseTo((0.0212 * 8 * HOUR) / HOUR, 6)
  })
})

const rowOf = (overrides: Partial<SandboxRunRow>): SandboxRunRow => ({
  id: 'run-1',
  sessionId: 'ses-1',
  userId: 'usr-1',
  provider: ESandboxCostProvider.Vercel,
  sandboxInstanceId: null,
  vcpus: 4,
  memoryGb: 8,
  diskGb: 0,
  startedAt: 0,
  endedAt: HOUR,
  activeCpuMs: null,
  cpuBaselineMs: null,
  awakeMs: null,
  costUsd: null,
  costSource: null,
  ...overrides,
})

describe('sandboxComputeOf', () => {
  test('is null when the session has no runs', () => {
    expect(sandboxComputeOf({ rows: [], now: HOUR })).toEqual({
      costUsd: null,
      running: false,
      tick: null,
    })
  })

  test('sums stored cost and estimates the open run', () => {
    const compute = sandboxComputeOf({
      now: HOUR,
      rows: [
        rowOf({ costUsd: 0.5, costSource: ESandboxCostSource.Measured }),
        rowOf({ id: 'run-2', endedAt: null, startedAt: 0 }),
      ],
    })
    expect(compute.running).toBe(true)
    expect(compute.costUsd).toBeCloseTo(0.5 + (0.0212 * 8 * HOUR) / HOUR, 6)
  })
})
