import { describe, expect, it } from 'bun:test'
import type { UsageReportDto } from '@dltech/atlas-protocol'
import { providerUsageAgeOf, providerUsageWindowsOf } from '../usage'

const now = Date.parse('2026-11-27T12:00:00Z')
const report: UsageReportDto = {
  accountId: 'one',
  label: 'Plan',
  metered: true,
  fetchedAt: new Date(now).toISOString(),
  fiveHour: { utilization: 68, resetsAt: new Date(now + 42 * 60_000).toISOString() },
  sevenDay: { utilization: 41, resetsAt: null },
}
describe('provider usage', () => {
  it('keeps window labels, utilization, bands and countdowns shared', () => {
    const windows = providerUsageWindowsOf({ report, now })
    expect(windows[0]).toMatchObject({
      label: '5-hour',
      text: '68%',
      percent: 68,
      countdown: '42m',
    })
    expect(windows[1]).toMatchObject({ label: '7-day', text: '41%', countdown: '' })
    expect(windows[0]?.band).not.toBe(windows[1]?.band)
  })
  it('clamps meter width and hides unmetered and absent daily windows', () => {
    expect(providerUsageWindowsOf({ report: { ...report, metered: false }, now })).toEqual([])
    expect(providerUsageWindowsOf({ report: { ...report, fiveHour: null }, now })).toHaveLength(1)
    expect(
      providerUsageWindowsOf({
        report: { ...report, fiveHour: { utilization: 200, resetsAt: null } },
        now,
      })[0]?.percent,
    ).toBe(100)
    expect(
      providerUsageWindowsOf({ report: { ...report, fiveHour: null, sevenDay: null }, now })[0]
        ?.text,
    ).toBe('—')
  })
  it('only labels readings at least five minutes old', () => {
    expect(providerUsageAgeOf({ fetchedAt: null, now })).toBeNull()
    expect(providerUsageAgeOf({ fetchedAt: 'bad', now })).toBeNull()
    expect(providerUsageAgeOf({ fetchedAt: report.fetchedAt, now })).toBeNull()
    expect(providerUsageAgeOf({ fetchedAt: new Date(now - 7 * 60_000).toISOString(), now })).toBe(
      'read 7m ago',
    )
  })
})
