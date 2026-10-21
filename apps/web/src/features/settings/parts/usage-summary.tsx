import { Sparkles } from 'lucide-react'

import { EUsageMetric, type SummaryEntry, type UsageSummary } from '../fixtures/settings-usage'
import { SettingsCard } from '../settings-layout'

const INSIGHTS: Record<EUsageMetric, string> = {
  [EUsageMetric.Tokens]: 'Claude Opus drives 53% of tokens, mostly on dltech/atlas threads.',
  [EUsageMetric.Cost]: 'Most spend (70%) comes from Claude Opus on dltech/atlas threads.',
}

export function UsageCallout({ metric }: { metric: EUsageMetric }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <Sparkles className="size-4 shrink-0 text-muted-foreground" />
      <span>{INSIGHTS[metric]}</span>
    </div>
  )
}

function BreakdownColumn({ title, entries }: { title: string; entries: SummaryEntry[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{entry.label}</dt>
            <dd className="font-mono text-xs tabular-nums">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function UsageSummaryCard({ summary }: { summary: UsageSummary }) {
  return (
    <SettingsCard>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-10 gap-y-4 p-4">
        <div className="flex flex-col justify-center gap-1">
          <span className="font-mono text-3xl font-semibold tabular-nums">{summary.total}</span>
          <span className="text-sm text-muted-foreground">{summary.caption}</span>
        </div>
        <BreakdownColumn title="By surface" entries={summary.surfaces} />
        <BreakdownColumn title="By model" entries={summary.models} />
      </div>
    </SettingsCard>
  )
}
