import { type AccountUsage, EUsageWindow } from '@dltech/atlas-core'
import type { UsageReportDto } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import {
  type ContextMeter,
  contextLabelOf,
  contextToneOf,
  EPopoverTone,
  popoverLinesOf,
  ringPercentOf,
  shownUsageOf,
} from '../context-reading'

const CONTEXT: ContextMeter = { used: 22_000, window: 200_000 }

const PLAN: AccountUsage = {
  [EUsageWindow.FiveHour]: { utilization: 68, resetsAt: null },
  [EUsageWindow.SevenDay]: { utilization: 41, resetsAt: null },
}

const REPORT: UsageReportDto = {
  accountId: null,
  label: null,
  metered: true,
  fetchedAt: null,
  ...PLAN,
}

describe('ringPercentOf', () => {
  it('reads the share of the window the context takes', () => {
    expect(ringPercentOf(CONTEXT)).toBe(11)
  })

  it('reads nothing before the window is measured', () => {
    expect(ringPercentOf(null)).toBeNull()
    expect(ringPercentOf({ used: null, window: 200_000 })).toBeNull()
    expect(ringPercentOf({ used: 1_000, window: null })).toBeNull()
  })
})

describe('contextToneOf', () => {
  it('warns at 70 and turns destructive at 90', () => {
    expect(contextToneOf(null)).toBe(EPopoverTone.Muted)
    expect(contextToneOf(69)).toBe(EPopoverTone.Foreground)
    expect(contextToneOf(70)).toBe(EPopoverTone.Warning)
    expect(contextToneOf(89)).toBe(EPopoverTone.Warning)
    expect(contextToneOf(90)).toBe(EPopoverTone.Destructive)
  })
})

describe('contextLabelOf', () => {
  it('names the ring for a reader who cannot see it', () => {
    expect(contextLabelOf(CONTEXT)).toBe('Context 11%')
    expect(contextLabelOf(null)).toBe('Context not measured yet')
  })
})

describe('shownUsageOf', () => {
  it('keeps a metered report and hides an unmetered one', () => {
    expect(shownUsageOf(REPORT)).toBe(REPORT)
    expect(shownUsageOf({ ...REPORT, metered: false })).toBeNull()
    expect(shownUsageOf(null)).toBeNull()
  })
})

describe('popoverLinesOf', () => {
  it('reads the context first, then each plan window', () => {
    expect(popoverLinesOf({ context: CONTEXT, usage: PLAN }).map((line) => line.text)).toEqual([
      'Context 11% used',
      '5h 68%',
      '7d 41%',
    ])
  })

  it('colours each line by its own band', () => {
    expect(popoverLinesOf({ context: CONTEXT, usage: PLAN }).map((line) => line.tone)).toEqual([
      EPopoverTone.Foreground,
      EPopoverTone.Warning,
      EPopoverTone.Foreground,
    ])
  })

  it('shows only the context when no plan reading is known', () => {
    expect(popoverLinesOf({ context: CONTEXT, usage: null }).map((line) => line.text)).toEqual([
      'Context 11% used',
    ])
  })

  it('says so when the context is not measured yet', () => {
    expect(popoverLinesOf({ context: null, usage: null })).toEqual([
      { key: 'context', text: 'Context not measured yet', tone: EPopoverTone.Muted },
    ])
  })
})
