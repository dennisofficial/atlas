import { describe, expect, it } from 'bun:test'
import { EUsageWindow } from '@dltech/atlas-core'

import { parseCodexUsage } from '../parse-codex-usage'

const RESET_AT = 1_788_000_000

const payload = (rateLimit: unknown): unknown => ({
  plan_type: 'plus',
  rate_limit: rateLimit,
  credits: null,
  additional_rate_limits: [],
})

describe('parseCodexUsage', () => {
  it('reads the primary window as five-hour and the secondary as seven-day', () => {
    const usage = parseCodexUsage(
      payload({
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 34,
          limit_window_seconds: 18_000,
          reset_after_seconds: 600,
          reset_at: RESET_AT,
        },
        secondary_window: {
          used_percent: 61,
          limit_window_seconds: 604_800,
          reset_after_seconds: 86_400,
          reset_at: RESET_AT + 1000,
        },
      }),
    )

    expect(usage[EUsageWindow.FiveHour]).toEqual({
      utilization: 34,
      resetsAt: new Date(RESET_AT * 1000).toISOString(),
    })
    expect(usage[EUsageWindow.SevenDay]).toEqual({
      utilization: 61,
      resetsAt: new Date((RESET_AT + 1000) * 1000).toISOString(),
    })
  })

  it('leaves the seven-day slot empty when the secondary window is missing', () => {
    const usage = parseCodexUsage(
      payload({ allowed: true, primary_window: { used_percent: 10, reset_at: RESET_AT } }),
    )

    expect(usage[EUsageWindow.FiveHour]?.utilization).toBe(10)
    expect(usage[EUsageWindow.SevenDay]).toBeNull()
  })

  it('clamps and rounds utilization into 0..100', () => {
    const usage = parseCodexUsage(
      payload({
        primary_window: { used_percent: -5 },
        secondary_window: { used_percent: 140.4 },
      }),
    )

    expect(usage[EUsageWindow.FiveHour]?.utilization).toBe(0)
    expect(usage[EUsageWindow.SevenDay]?.utilization).toBe(100)
  })

  it('derives the reset from reset_after_seconds when reset_at is absent', () => {
    const now = 1_700_000_000_000
    const usage = parseCodexUsage(
      payload({ primary_window: { used_percent: 50, reset_after_seconds: 120 } }),
      () => now,
    )

    expect(usage[EUsageWindow.FiveHour]?.resetsAt).toBe(new Date(now + 120_000).toISOString())
  })

  it('reports no reset when neither reset field is present', () => {
    const usage = parseCodexUsage(payload({ primary_window: { used_percent: 50 } }))
    expect(usage[EUsageWindow.FiveHour]).toEqual({ utilization: 50, resetsAt: null })
  })

  it('drops a window whose used_percent is not a number', () => {
    const usage = parseCodexUsage(
      payload({
        primary_window: { used_percent: '34' },
        secondary_window: { used_percent: Number.NaN },
      }),
    )

    expect(usage[EUsageWindow.FiveHour]).toBeNull()
    expect(usage[EUsageWindow.SevenDay]).toBeNull()
  })

  const bodiesWithoutRateLimit: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['a null rate_limit', { rate_limit: null }],
    ['a string rate_limit', { rate_limit: 'x' }],
  ]

  for (const [label, body] of bodiesWithoutRateLimit) {
    it(`returns empty windows for a body that is ${label}`, () => {
      const usage = parseCodexUsage(body)
      expect(usage[EUsageWindow.FiveHour]).toBeNull()
      expect(usage[EUsageWindow.SevenDay]).toBeNull()
    })
  }
})
