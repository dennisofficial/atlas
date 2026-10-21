'use client'

import { useMemo, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import { buildSummary, EUsageMetric, EUsageRange } from '../fixtures/settings-usage'
import { ALL_THREAD_SPEND, DAILY_SPEND, RECENT_THREAD_SPEND } from '../fixtures/settings-usage-rows'
import { UsageBubbleChart } from '../parts/usage-bubble-chart'
import { UsageDailyTable } from '../parts/usage-daily-table'
import { UsageRecentTable } from '../parts/usage-recent-table'
import { UsageCallout, UsageSummaryCard } from '../parts/usage-summary'
import { UsageThreadsTable } from '../parts/usage-threads-table'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

const METRICS = [
  { value: EUsageMetric.Tokens, label: 'Tokens' },
  { value: EUsageMetric.Cost, label: 'Cost' },
]

const RANGES = [EUsageRange.Week, EUsageRange.Fortnight, EUsageRange.Month, EUsageRange.Quarter]

function isMetric(value: string): value is EUsageMetric {
  return METRICS.some((metric) => metric.value === value)
}

function isRange(value: string): value is EUsageRange {
  return RANGES.some((range) => range === value)
}

export function UsageModelsPage() {
  const [metric, setMetric] = useState(EUsageMetric.Tokens)
  const [range, setRange] = useState(EUsageRange.Week)
  const summary = useMemo(() => buildSummary({ metric, range }), [metric, range])

  function handleMetricChange(values: string[]) {
    const next = values[0]
    if (next && isMetric(next)) setMetric(next)
  }

  function handleRangeChange(values: string[]) {
    const next = values[0]
    if (next && isRange(next)) setRange(next)
  }

  return (
    <SettingsPage
      title="Usage: Models"
      description="Token and spend across your threads, surfaces, and models."
      actions={
        <>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[metric]}
            onValueChange={handleMetricChange}
            aria-label="Usage metric"
          >
            {METRICS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[range]}
            onValueChange={handleRangeChange}
            aria-label="Time range"
          >
            {RANGES.map((item) => (
              <ToggleGroupItem key={item} value={item} className="font-mono">
                {item}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </>
      }
    >
      <SettingsCard>
        <div className="p-4">
          <UsageBubbleChart metric={metric} range={range} />
        </div>
      </SettingsCard>
      <UsageCallout metric={metric} />
      <UsageSummaryCard summary={summary} />
      <SettingsSection title="Last 12 hours" description="Spend by thread since this morning.">
        <UsageRecentTable threads={RECENT_THREAD_SPEND} />
      </SettingsSection>
      <SettingsSection title="Daily spend" description="Per-model breakdown for each day.">
        <UsageDailyTable days={DAILY_SPEND} />
      </SettingsSection>
      <SettingsSection
        title="Threads"
        actions={
          <Button variant="ghost" size="xs">
            View all
          </Button>
        }
      >
        <UsageThreadsTable threads={ALL_THREAD_SPEND} />
      </SettingsSection>
    </SettingsPage>
  )
}
