import type { ArtifactStatus, ArtifactSummary, ArtifactVersionSummary } from '@dltech/atlas-wire'

const UNITS = ['B', 'KB', 'MB', 'GB'] as const
const STEP = 1024

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

export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value = value / STEP
    unit += 1
  }
  if (unit === 0) return `${Math.round(value)} B`
  return `${value.toFixed(1)} ${UNITS[unit] ?? 'B'}`
}

export function truncateMiddle(text: string, max = 32): string {
  if (text.length <= max) return text
  const tail = Math.ceil((max - 1) / 2)
  const head = max - 1 - tail
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

export const artifactsNewestFirst = (artifacts: readonly ArtifactSummary[]): ArtifactSummary[] =>
  [...artifacts].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))

export const versionsNewestFirst = (
  versions: readonly ArtifactVersionSummary[],
): ArtifactVersionSummary[] => [...versions].sort((left, right) => right.version - left.version)

export const baseUrlOf = (url: string): string => (url.endsWith('/') ? url.slice(0, -1) : url)

export const fileHrefOf = (args: { baseUrl: string; path: string }): string =>
  `${args.baseUrl}/${args.path}`

export function rollbackTargetOf(args: {
  versions: readonly ArtifactVersionSummary[]
  current: number
}): number | null {
  const target = versionsNewestFirst(args.versions).find(
    (version) => version.status === 'ready' && version.version !== args.current,
  )
  return target === undefined ? null : target.version
}
