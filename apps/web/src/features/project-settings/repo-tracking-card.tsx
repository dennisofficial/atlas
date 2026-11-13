'use client'

import { ERepoTracking, type ProjectRepoTracking } from '@dltech/atlas-wire/web'

import { SettingsCard, SettingsRow } from './settings-layout'

const TRACKING_LABELS: Record<ERepoTracking, string> = {
  [ERepoTracking.App]: 'App webhook',
  [ERepoTracking.User]: 'User webhook',
  [ERepoTracking.Polled]: 'Polled — refreshes every 60s while open',
}

export function RepoTrackingCard({ repos }: { repos: readonly ProjectRepoTracking[] }) {
  return (
    <SettingsCard>
      {repos.map((binding) => (
        <SettingsRow
          key={binding.repo}
          title={<span className="font-mono text-xs">{binding.repo}</span>}
          description={
            binding.branch === undefined ? undefined : (
              <span className="font-mono text-xs">{binding.branch}</span>
            )
          }
        >
          <span className="text-sm text-muted-foreground">{TRACKING_LABELS[binding.tracking]}</span>
        </SettingsRow>
      ))}
    </SettingsCard>
  )
}
