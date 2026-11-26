import { describe, expect, it } from 'bun:test'

import { EAuthProvider } from '../../credentials/account'
import { EMeterBand } from '../meter'
import { planUsageLabelOf, planUsageReadingsOf, usageProviderOf } from '../reading'
import { EUsageWindow, type AccountUsage } from '../window'

const PLAN: AccountUsage = {
  [EUsageWindow.FiveHour]: { utilization: 68, resetsAt: null },
  [EUsageWindow.SevenDay]: { utilization: 41, resetsAt: null },
}

describe('usageProviderOf', () => {
  it('reads the provider of the model the session runs on', () => {
    expect(usageProviderOf({ ref: 'anthropic/claude-opus-4-5' })).toBe(EAuthProvider.Anthropic)
    expect(usageProviderOf({ ref: 'openai/gpt-5.5' })).toBe(EAuthProvider.OpenAI)
  })

  it('has no provider for a model no plan account backs', () => {
    expect(usageProviderOf({ ref: 'nowhere/some-model' })).toBeNull()
    expect(usageProviderOf({ ref: 'no-slash' })).toBeNull()
    expect(usageProviderOf(null)).toBeNull()
  })
})

describe('planUsageReadingsOf', () => {
  it('reads both windows of a plan with both limits', () => {
    const readings = planUsageReadingsOf(PLAN)
    expect(readings.map((reading) => reading.short)).toEqual(['5h', '7d'])
    expect(readings.map((reading) => reading.utilization)).toEqual([68, 41])
    expect(readings[0]?.band).toBe(EMeterBand.Warn)
    expect(readings[1]?.band).toBe(EMeterBand.Normal)
  })

  it('hides the window a plan does not report', () => {
    const readings = planUsageReadingsOf({ ...PLAN, [EUsageWindow.FiveHour]: null })
    expect(readings.map((reading) => reading.short)).toEqual(['7d'])
  })

  it('keeps both windows when the plan reports neither', () => {
    const readings = planUsageReadingsOf({
      [EUsageWindow.FiveHour]: null,
      [EUsageWindow.SevenDay]: null,
    })
    expect(readings.map((reading) => reading.band)).toEqual([
      EMeterBand.Unknown,
      EMeterBand.Unknown,
    ])
  })
})

describe('planUsageLabelOf', () => {
  it('names every shown window in full', () => {
    expect(planUsageLabelOf(PLAN)).toBe('Plan usage: 5-hour 68%, 7-day 41%')
  })
})
