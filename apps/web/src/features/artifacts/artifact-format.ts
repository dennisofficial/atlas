import type { ArtifactStatus, ArtifactSummary } from '@dltech/atlas-wire/web'

const STATUS_LABELS: Record<ArtifactStatus, string> = {
  ready: 'Live',
  building: 'Building',
  failed: 'Failed',
}

export type StatusBadgeVariant = 'default' | 'outline' | 'destructive'

const STATUS_VARIANTS: Record<ArtifactStatus, StatusBadgeVariant> = {
  ready: 'default',
  building: 'outline',
  failed: 'destructive',
}

export const statusLabelOf = (status: ArtifactStatus): string => STATUS_LABELS[status]

export const statusVariantOf = (status: ArtifactStatus): StatusBadgeVariant =>
  STATUS_VARIANTS[status]

export const artifactsNewestFirst = (artifacts: readonly ArtifactSummary[]): ArtifactSummary[] =>
  [...artifacts].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—'
  if (durationMs < 1000) return `${durationMs} ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
