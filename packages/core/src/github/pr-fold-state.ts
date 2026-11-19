import type { EChecksState } from './checks'
import type { EPrSource, MergeabilitySample, PullSample } from './pr-observation'

export type PrChecksSummary = {
  headSha: string
  running: number
  passed: number
  failed: number
  ignored: number
  rollup: EChecksState | null
}

export type PrFoldState = {
  repoFullName: string
  prNumber: number
  pull: (PullSample & { source: EPrSource }) | null
  mergeability: MergeabilitySample | null
  checks: PrChecksSummary | null
  version: number
}

export type PrFoldChange = 'pull' | 'mergeability' | 'checks'

export type PrUncertainty = 'mergeability-unknown' | 'checks-absent' | 'pull-absent'

export type PrEffect = {
  kind: 'reconcile-checks'
  headSha: string
  repoFullName: string
}

export type PrFoldResult = {
  state: PrFoldState | null
  changed: readonly PrFoldChange[]
  uncertainty: readonly PrUncertainty[]
}
