import { type AccountUsage, EUsageWindow } from '@dltech/atlas-core'
import type { UsageReportDto } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import {
  type ContextMeter,
  contextLabelOf,
  contextToneOf,
  EPopoverTone,
  popoverSectionsOf,
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

describe('popoverSectionsOf', () => {
  const NOW = Date.parse('2026-11-27T10:00:00.000Z')
  const RESETTING: AccountUsage = {
    [EUsageWindow.FiveHour]: { utilization: 68, resetsAt: '2026-11-27T12:14:00.000Z' },
    [EUsageWindow.SevenDay]: { utilization: 41, resetsAt: null },
  }

  it('reads the context as a meter with its token counts', () => {
    const [section] = popoverSectionsOf({ context: CONTEXT, usage: null, now: NOW })
    expect(section).toEqual({
      key: 'context',
      title: null,
      meters: [
        {
          key: 'context',
          label: 'Context window',
          value: '11%',
          fraction: 0.11,
          detail: '22k of 200k tokens',
          tone: EPopoverTone.Foreground,
        },
      ],
    })
  })

  it('writes a million-token window compactly', () => {
    const [section] = popoverSectionsOf({
      context: { used: 340_000, window: 1_000_000 },
      usage: null,
      now: NOW,
    })
    expect(section?.meters[0]?.detail).toBe('340k of 1M tokens')
  })

  it('groups each plan window under plan usage with its reset', () => {
    const sections = popoverSectionsOf({ context: CONTEXT, usage: RESETTING, now: NOW })
    expect(sections.map((section) => section.title)).toEqual([null, 'Plan usage'])
    expect(sections[1]?.meters.map((meter) => [meter.label, meter.value, meter.detail])).toEqual([
      ['5-hour limit', '68%', 'Resets in 2h14m'],
      ['7-day limit', '41%', null],
    ])
  })

  it('colours each meter by its own band', () => {
    const sections = popoverSectionsOf({ context: CONTEXT, usage: PLAN, now: NOW })
    expect(sections.flatMap((section) => section.meters.map((meter) => meter.tone))).toEqual([
      EPopoverTone.Foreground,
      EPopoverTone.Warning,
      EPopoverTone.Foreground,
    ])
  })

  it('shows only the context when no plan reading is known', () => {
    expect(popoverSectionsOf({ context: CONTEXT, usage: null, now: NOW })).toHaveLength(1)
  })

  it('shows an empty muted meter before the context is measured', () => {
    const [section] = popoverSectionsOf({ context: null, usage: null, now: NOW })
    expect(section?.meters[0]).toMatchObject({
      value: '—',
      fraction: 0,
      detail: 'Not measured yet',
      tone: EPopoverTone.Muted,
    })
  })
})
