import { EDatasetSplit, type DatasetManifest } from './manifest'
import { ERunMode, ERunStatus, type RunSummary } from './results'

export function promotionEligible(args: {
  summary: Pick<RunSummary, 'promotable' | 'mode' | 'status' | 'operationalFailures'>
  dataset: Pick<DatasetManifest, 'split' | 'metricGates'>
}): boolean {
  const { summary, dataset } = args
  return summary.promotable && summary.mode === ERunMode.Live &&
    summary.status === ERunStatus.Complete && summary.operationalFailures === 0 &&
    dataset.split === EDatasetSplit.Holdout && dataset.metricGates.length > 0
}
